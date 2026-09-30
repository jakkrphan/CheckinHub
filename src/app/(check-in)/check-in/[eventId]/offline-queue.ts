"use client";

type QueuedScan = {
  id: string;
  operatorId: string;
  eventId: string;
  sessionId: string;
  queuedAt: number;
  iv: Uint8Array<ArrayBuffer>;
  encryptedCode: ArrayBuffer;
  lastError?: ReviewReason;
  lastMessage?: string;
};

type ReviewReason = "invalid" | "wrong-day" | "session-missing";
const reviewReasons: string[] = ["invalid", "wrong-day", "session-missing"];

export type ReviewScan = { id: string; sessionId: string; queuedAt: number; reason: ReviewReason; message: string };

const DATABASE = "checkinhub-checkin-queue-v1";
const SCANS = "scans";
const KEYS = "keys";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function openQueue() {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    database.createObjectStore(SCANS, { keyPath: "id" });
    database.createObjectStore(KEYS);
  };
  return requestResult(request);
}

async function readKey(database: IDBDatabase): Promise<CryptoKey> {
  const existing = await requestResult<CryptoKey | undefined>(database.transaction(KEYS).objectStore(KEYS).get("device"));
  if (existing) return existing;
  const created = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  try {
    const transaction = database.transaction(KEYS, "readwrite");
    transaction.objectStore(KEYS).add(created, "device");
    await transactionDone(transaction);
    return created;
  } catch {
    const concurrent = await requestResult<CryptoKey | undefined>(database.transaction(KEYS).objectStore(KEYS).get("device"));
    if (concurrent) return concurrent;
    throw new Error("Cannot store offline encryption key");
  }
}

/**
 * `clientEventId` keeps the id of an online attempt whose answer was lost, so a retry the server already saved is
 * recognised as the same scan rather than a check-in from another device.
 */
export async function queueScan(operatorId: string, eventId: string, sessionId: string, code: string, clientEventId: string = crypto.randomUUID()) {
  const database = await openQueue();
  try {
    const key = await readKey(database);
    const id = clientEventId;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedCode = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(id) }, key, encoder.encode(code));
    const item: QueuedScan = { id, operatorId, eventId, sessionId, queuedAt: Date.now(), iv, encryptedCode };
    const transaction = database.transaction(SCANS, "readwrite");
    transaction.objectStore(SCANS).put(item);
    await transactionDone(transaction);
  } finally { database.close(); }
}

export async function pendingScanCount(operatorId: string) {
  const database = await openQueue();
  try { return (await requestResult<QueuedScan[]>(database.transaction(SCANS).objectStore(SCANS).getAll())).filter((scan) => scan.operatorId === operatorId).length; }
  finally { database.close(); }
}

/** Scans another staff account left on this device; only that account can sync them, so staff must be told. */
export async function otherOperatorScanCount(operatorId: string) {
  const database = await openQueue();
  try { return (await requestResult<QueuedScan[]>(database.transaction(SCANS).objectStore(SCANS).getAll())).filter((scan) => scan.operatorId !== operatorId).length; }
  finally { database.close(); }
}

export async function syncQueuedScans(operatorId: string, send: (eventId: string, sessionId: string, code: string, clientEventId: string, scannedAt: string) => Promise<{ kind: string; message: string; alreadySaved?: boolean }>, retryRejected = false) {
  const database = await openQueue();
  let synced = 0;
  let alreadyChecked = 0;
  let rejected = 0;
  let blocked = false;
  try {
    const key = await readKey(database);
    const scans = await requestResult<QueuedScan[]>(database.transaction(SCANS).objectStore(SCANS).getAll());
    scans.sort((a, b) => a.queuedAt - b.queuedAt);
    for (const scan of scans.filter((item) => item.operatorId === operatorId && (retryRejected || !item.lastError))) {
      let code: string;
      try {
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: scan.iv, additionalData: encoder.encode(scan.id) }, key, scan.encryptedCode);
        code = decoder.decode(decrypted);
      } catch { throw new Error("Cannot decrypt queued check-in"); }
      const result = await send(scan.eventId, scan.sessionId, code, scan.id, new Date(scan.queuedAt).toISOString());
      if (result.kind === "error") { blocked = true; break; }
      // Revoked people, wrong days and deleted sessions are never saved; they stay on the device for staff review.
      if (reviewReasons.includes(result.kind)) {
        rejected++;
        const transaction = database.transaction(SCANS, "readwrite");
        transaction.objectStore(SCANS).put({ ...scan, lastError: result.kind as ReviewReason, lastMessage: result.message });
        await transactionDone(transaction);
        continue;
      }
      // A scan the server saved before its answer was lost counts as synced, not as another device's check-in.
      if (result.kind === "success" || result.alreadySaved) synced++;
      else if (result.kind === "duplicate") alreadyChecked++;
      const transaction = database.transaction(SCANS, "readwrite");
      transaction.objectStore(SCANS).delete(scan.id);
      await transactionDone(transaction);
    }
    const remaining = (await requestResult<QueuedScan[]>(database.transaction(SCANS).objectStore(SCANS).getAll())).filter((scan) => scan.operatorId === operatorId);
    return { synced, alreadyChecked, rejected, blocked, pending: remaining.length, needsReview: remaining.filter((scan) => !!scan.lastError).length };
  } finally { database.close(); }
}

export async function listReviewScans(operatorId: string): Promise<ReviewScan[]> {
  const database = await openQueue();
  try {
    const scans = await requestResult<QueuedScan[]>(database.transaction(SCANS).objectStore(SCANS).getAll());
    return scans
      .filter((scan) => scan.operatorId === operatorId && !!scan.lastError)
      .sort((a, b) => a.queuedAt - b.queuedAt)
      .map((scan) => ({ id: scan.id, sessionId: scan.sessionId, queuedAt: scan.queuedAt, reason: scan.lastError!, message: scan.lastMessage ?? "ตรวจสอบไม่ผ่าน" }));
  } finally { database.close(); }
}

export async function discardRejectedScans(operatorId: string) {
  const database = await openQueue();
  try {
    const rejected = (await requestResult<QueuedScan[]>(database.transaction(SCANS).objectStore(SCANS).getAll())).filter((scan) => scan.operatorId === operatorId && !!scan.lastError);
    if (!rejected.length) return 0;
    const transaction = database.transaction(SCANS, "readwrite");
    for (const scan of rejected) transaction.objectStore(SCANS).delete(scan.id);
    await transactionDone(transaction);
    return rejected.length;
  } finally { database.close(); }
}
