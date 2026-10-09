import { copyFile, mkdir, open, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

import { db } from "@/server/db";
import { uploadRoot } from "@/server/registrations/upload-storage";

// The one place that touches stored files (attachments and cover images). Everything else passes keys, so moving
// to object storage (S3 / MinIO) later means replacing this module only. Keys are random names we generated;
// anything else is refused, so a key from the database can never reach outside the upload folder.
// Every write, copy and delete first records its key in PendingFile, so a file left behind by a crash or a failed
// delete is found again by the orphan sweep (retention.ts), and the sweep never touches a file this database did not write.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A registrant's upload: `<uuid>.pdf|jpg|png|webp|docx`. */
export const ATTACHMENT_KEY = new RegExp(`^${UUID}\\.(pdf|jpg|png|webp|docx)$`, "i");
/** An event's cover: `<uuid>.webp` (or jpg/png from before covers were re-encoded). */
export const COVER_KEY = new RegExp(`^${UUID}\\.(jpg|png|webp)$`, "i");
/** A cover's small version: `<uuid>.thumb.webp`. */
export const THUMB_KEY = new RegExp(`^${UUID}\\.thumb\\.webp$`, "i");
/** Whether a key is one we generate (attachment, cover or thumbnail); covers are a subset of attachment keys. */
export const isStoredKey = (key: string) => ATTACHMENT_KEY.test(key) || THUMB_KEY.test(key);

/** Filesystem work on many files runs this many at a time, so a big folder cannot exhaust file handles. */
const PARALLEL = 50;
async function inChunks<T, R>(items: T[], work: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += PARALLEL) results.push(...await Promise.all(items.slice(start, start + PARALLEL).map(work)));
  return results;
}

/**
 * Records keys that may end up unreferenced; a key already recorded keeps its original time. Only keys we generate
 * are recorded (anything else never names a stored file, and could overflow the column). Returns the query unawaited,
 * so callers that drop file answers can pass `tx` or put it in their transaction: the record must commit with the change.
 */
export function recordPending(keys: string[], client: Pick<typeof db, "pendingFile"> = db) {
  return client.pendingFile.createMany({ data: keys.filter(isStoredKey).map((key) => ({ key })), skipDuplicates: true });
}

function pathOf(key: string) {
  const root = uploadRoot();
  if (!root || !isStoredKey(key)) return null;
  // turbopackIgnore (here and at every fs call): the folder is only known at runtime; without it the build traces the whole project.
  return join(/* turbopackIgnore: true */ root, key);
}

/** Writes a new file; never overwrites (keys are random, a clash is a bug). */
export async function putFile(key: string, bytes: Buffer) {
  const root = uploadRoot();
  const path = pathOf(key);
  if (!root || !path) throw new Error("File storage unavailable or invalid key");
  await recordPending([key]);
  await mkdir(/* turbopackIgnore: true */ root, { recursive: true, mode: 0o700 });
  await writeFile(/* turbopackIgnore: true */ path, bytes, { flag: "wx", mode: 0o600 });
}

/**
 * A stream for sending a file without loading it into memory, with its size for Content-Length. The file is opened
 * first, so one deleted a moment later still sends completely (the open handle keeps it readable) instead of a 200
 * that breaks off. Call `body.cancel()` if the stream will not be sent, so the file is closed.
 */
export async function openStoredFile(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> {
  const path = pathOf(key);
  if (!path) return null;
  let handle;
  try { handle = await open(/* turbopackIgnore: true */ path, "r"); } catch { return null; }
  try {
    const info = await handle.stat();
    if (!info.isFile()) { await handle.close(); return null; }
    return { body: Readable.toWeb(handle.createReadStream({ autoClose: true })) as ReadableStream<Uint8Array>, size: info.size };
  } catch {
    await handle.close().catch(() => undefined);
    return null;
  }
}

/** The size of a stored file without opening it (for HEAD requests), or null when it is not there. */
export async function statStoredFile(key: string) {
  const path = pathOf(key);
  if (!path) return null;
  try {
    const info = await stat(/* turbopackIgnore: true */ path);
    return info.isFile() ? { size: info.size } : null;
  } catch { return null; }
}

/**
 * Removes files; a file already gone is fine. The keys are recorded first and each is released once its file is gone,
 * so a delete that fails (or a crash part-way) is retried by the orphan sweep. Every file is tried; failures are
 * thrown together afterwards as an AggregateError whose errors carry the `key`, so one stuck file never keeps the others.
 */
export async function deleteStoredFiles(keys: (string | null | undefined)[]) {
  const ours = keys.filter((key): key is string => !!key && isStoredKey(key));
  if (!ours.length) return;
  await recordPending(ours);
  // Without a folder (UPLOAD_DIR unset) nothing can be deleted: the records stay, so the sweep finds the files once it is back.
  if (!uploadRoot()) return;
  const failed = (await inChunks(ours, async (key) => {
    try { await unlink(/* turbopackIgnore: true */ pathOf(key)!); return null; } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : Object.assign(error as Error, { key });
    }
  })).filter((error) => error !== null);
  const stuck = new Set(failed.map((error) => error.key));
  await db.pendingFile.deleteMany({ where: { key: { in: ours.filter((key) => !stuck.has(key)) } } });
  if (failed.length) throw new AggregateError(failed, `${failed.length} stored files could not be deleted`);
}

/** Copies a file to a new key; false when the source no longer exists. A half-written copy is left to the orphan sweep. */
export async function copyStoredFile(from: string, to: string) {
  const source = pathOf(from);
  const target = pathOf(to);
  if (!source || !target) return false;
  await recordPending([to]);
  try {
    await copyFile(/* turbopackIgnore: true */ source, /* turbopackIgnore: true */ target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
