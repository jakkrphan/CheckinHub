// Unit tests for the orphan sweep and the files side of retention: only journaled (PendingFile) keys a day old are
// looked at, referenced ones are kept, and a failed delete during anonymization is left for the sweep.
// Runs against a throwaway UPLOAD_DIR and an in-memory database, never the real ones.
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const folder = await mkdtemp(join(tmpdir(), "checkinhub-retention-"));
process.env.UPLOAD_DIR = folder;
test.after(() => rm(folder, { recursive: true, force: true }));

const DAY = 86400000;
const now = new Date("2026-10-09T03:00:00Z");
const key = (n, ext = "pdf") => `${String(n).padStart(8, "0")}-1f5c-4d8a-9c1e-2f3a4b5c6d7e.${ext}`;

// Only what retention.ts and file-store.ts call. db.ts reuses globalThis.prisma, so nothing connects to MySQL.
const state = { pending: new Map(), events: [], registrants: [], audit: [] };
globalThis.prisma = {
  pendingFile: {
    createMany: async ({ data }) => { for (const row of data) if (!state.pending.has(row.key)) state.pending.set(row.key, new Date()); },
    deleteMany: async ({ where }) => { for (const k of where.key.in) state.pending.delete(k); },
    findMany: async ({ where, take }) => [...state.pending].filter(([k, at]) => at < where.createdAt.lt && k > where.key.gt)
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, take).map(([k]) => ({ key: k })),
  },
  event: {
    findMany: async ({ where }) => where.coverImageKey ? state.events.filter((e) => e.coverImageKey) : state.events.filter((e) => !e.anonymizedAt),
    update: async ({ where, data }) => Object.assign(state.events.find((e) => e.id === where.id), data),
  },
  registrant: {
    findMany: async ({ where }) => state.registrants.filter((r) => r.eventId === where.eventId && !r.anonymizedAt),
    update: async ({ where, data }) => Object.assign(state.registrants.find((r) => r.id === where.id), data),
  },
  auditLog: { create: async ({ data }) => state.audit.push(data) },
  // The registrants-with-uploads query of the sweep (MySQL does the JSON filtering; here every live registrant comes back).
  $queryRaw: async () => state.registrants.filter((r) => !r.anonymizedAt).map(({ id, answers }) => ({ id, answers: JSON.stringify(answers) })),
  $transaction: (operations) => Promise.all(operations),
};
const { anonymizeExpiredEvents, sweepOrphanFiles } = await import("./retention.ts");

const exists = (k) => access(join(folder, k)).then(() => true, () => false);
async function stored(k, journaledAt) {
  await writeFile(join(folder, k), "x");
  if (journaledAt) state.pending.set(k, journaledAt);
}
const reset = () => { state.pending.clear(); state.events = []; state.registrants = []; state.audit = []; };
const file = (storageKey) => ({ storageKey, originalName: "a.pdf", contentType: "application/pdf", size: 1 });
const twoDaysAgo = new Date(now.getTime() - 2 * DAY);

test("the sweep deletes old unreferenced journaled files and keeps covers, thumbnails and every kind of answer", async () => {
  reset();
  const cover = key(1, "webp");
  const thumb = key(1, "thumb.webp");
  state.events = [{ id: "e1", coverImageKey: cover }];
  state.registrants = [{ id: "r1", eventId: "e1", answers: { single: file(key(2)), multi: [file(key(3)), file(key(4))], removedField: file(key(5)), name: "x" } }];
  for (const k of [cover, thumb, key(2), key(3), key(4), key(5), key(6), key(7, "webp"), key(7, "thumb.webp")]) await stored(k, twoDaysAgo);

  assert.equal(await sweepOrphanFiles(now), 3);
  for (const k of [cover, thumb, key(2), key(3), key(4), key(5)]) assert.ok(await exists(k), `kept ${k}`);
  for (const k of [key(6), key(7, "webp"), key(7, "thumb.webp")]) assert.equal(await exists(k), false, `deleted ${k}`);
  assert.equal(state.pending.size, 0, "referenced keys lose their record, deleted ones too");
});

test("the sweep never touches files it did not journal, nor records younger than a day", async () => {
  reset();
  await stored(key(10)); // not journaled: another install's file, or one stored before the journal existed
  await stored(key(11), new Date(now.getTime() - DAY + 60_000)); // an upload whose row may still be saving
  assert.equal(await sweepOrphanFiles(now), 0);
  assert.ok(await exists(key(10)));
  assert.ok(await exists(key(11)));
  assert.ok(state.pending.has(key(11)));
});

test("a journaled key whose file is already gone just loses its record", async () => {
  reset();
  state.pending.set(key(12), twoDaysAgo);
  assert.equal(await sweepOrphanFiles(now), 1);
  assert.equal(state.pending.size, 0);
});

test("a file that cannot be deleted stays recorded without stopping the rest of the sweep", async () => {
  reset();
  await mkdir(join(folder, key(30))); // sorts first, and its unlink fails every time
  for (const k of [key(31), key(32)]) await stored(k, twoDaysAgo);
  state.pending.set(key(30), twoDaysAgo);
  const original = console.error;
  console.error = () => undefined;
  try { assert.equal(await sweepOrphanFiles(now), 2); } finally { console.error = original; }
  assert.equal(await exists(key(31)) || await exists(key(32)), false);
  assert.deepEqual([...state.pending.keys()], [key(30)]);
  await rm(join(folder, key(30)), { recursive: true });
});

test("a recorded key that is not one of ours is released, never counted again", async () => {
  reset();
  state.pending.set("not-a-generated-key.pdf", twoDaysAgo);
  assert.equal(await sweepOrphanFiles(now), 0, "no file was deleted");
  assert.equal(state.pending.size, 0);
});

test("answers holding a key we never generate (e.g. too long for the journal) are anonymized and not journaled", async () => {
  reset();
  const odd = `${"x".repeat(80)}.pdf`;
  state.events = [{ id: "e3", retentionDays: 30, anonymizedAt: null, days: [{ date: new Date(now.getTime() - 40 * DAY) }] }];
  state.registrants = [{ id: "r3", eventId: "e3", answers: { doc: file(odd) } }];
  assert.equal((await anonymizeExpiredEvents(now)).anonymizedRegistrants, 1);
  assert.deepEqual(state.registrants[0].answers, {});
  assert.equal(state.pending.has(odd), false);
});

test("a failed delete during anonymization does not stop retention, and the sweep removes the file later", async () => {
  reset();
  state.events = [{ id: "e2", retentionDays: 30, anonymizedAt: null, days: [{ date: new Date(now.getTime() - 40 * DAY) }] }];
  state.registrants = [{ id: "r2", eventId: "e2", answers: { doc: file(key(20)), more: [file(key(21))] } }];
  await stored(key(20));
  await mkdir(join(folder, key(21))); // a folder where the file should be, so its unlink fails
  const logged = [];
  const original = console.error;
  console.error = (message) => logged.push(message);
  try {
    assert.deepEqual(await anonymizeExpiredEvents(now), { checkedEvents: 1, anonymizedEvents: 1, anonymizedRegistrants: 1 });
  } finally { console.error = original; }
  assert.deepEqual(state.registrants[0].answers, {});
  assert.ok(state.events[0].anonymizedAt, "the event is marked done although a file is left");
  assert.equal(logged.length, 1);
  assert.ok(state.pending.has(key(21)), "the stuck file stays journaled");

  await rm(join(folder, key(21)), { recursive: true });
  await writeFile(join(folder, key(21)), "x"); // whatever blocked the delete is fixed
  state.pending.set(key(21), twoDaysAgo);
  assert.equal(await sweepOrphanFiles(now), 1);
  assert.equal(await exists(key(21)), false);
});
