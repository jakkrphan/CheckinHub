// Uses local MySQL fixtures and an injected SMTP sender. Never sends real mail or calls the global outbox.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { processEmailQueue } from "../src/server/email/delivery.ts";

nextEnv.loadEnvConfig(process.cwd());
const databaseUrl = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(databaseUrl.hostname), "Email smoke tests require a local database");
const db = new PrismaClient({ errorFormat: "minimal" });
const delivered = [];
let eventId;
const options = { enabled: true, origin: "https://example.test", statusToken: () => "test-status-token", send: async (message) => { delivered.push(message); return { ok: true }; } };
try {
  const owner = await db.user.findFirstOrThrow({ select: { id: true } });
  const event = await db.event.create({ data: { title: "Email smoke", slug: `email-smoke-${randomUUID()}`, ownerId: owner.id, fields: [], days: { create: [{ date: new Date("2031-12-01") }] } }, include: { days: true } });
  eventId = event.id;
  const person = await db.registrant.create({ data: {
    eventId, email: "test@example.invalid", answers: {}, status: "APPROVED", qrCode: "test-qr", statusTokenHash: randomUUID(), consentedAt: new Date(),
    days: { create: [{ eventDayId: event.days[0].id, status: "APPROVED" }] },
  } });
  const queue = (data = {}) => db.notificationLog.create({ data: { eventId, registrantId: person.id, channel: "EMAIL", kind: "status", retryKey: randomUUID(), ...data } });
  const run = (overrides = {}) => processEmailQueue(db, { ...options, ...overrides }, 25, person.id);
  let row = await queue();
  const concurrent = await Promise.all([run(), run()]);
  assert.equal(concurrent.reduce((sum, result) => sum + result.sent, 0), 1);
  assert.equal(delivered.length, 1, "Concurrent workers must claim a row once");
  assert.equal(delivered[0].qr.subarray(1, 4).toString(), "PNG");
  assert.ok(delivered[0].text.includes("test-status-token"));
  assert.equal((await db.notificationLog.findUniqueOrThrow({ where: { id: row.id } })).status, "SENT");

  await queue({ kind: "fallback" });
  assert.equal((await run()).skipped, 1, "LINE fallback must not repeat an already-emailed result");
  assert.equal(delivered.length, 1);

  await db.registrantEventDay.updateMany({ where: { registrantId: person.id }, data: { status: "REJECTED" } });
  await db.registrant.update({ where: { id: person.id }, data: { status: "REJECTED", qrCode: null, rejectReason: "ทดสอบ" } });
  row = await queue();
  assert.equal((await run({ send: async () => ({ ok: false, retry: true, error: "SMTP 451" }) })).retry, 1);
  let queued = await db.notificationLog.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(queued.status, "QUEUED"); assert.equal(queued.attempts, 1); assert.ok(queued.nextAttemptAt > new Date());
  assert.equal((await run()).sent, 0, "Backoff must delay retry");
  await db.notificationLog.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } });
  assert.equal((await run()).sent, 1);
  assert.equal(delivered.at(-1).qr, undefined);
  assert.equal(delivered.at(-1).retryKey, queued.retryKey);

  await db.registrant.update({ where: { id: person.id }, data: { emailNotifiedHash: null } });
  row = await queue();
  assert.equal((await run({ send: async () => ({ ok: false, retry: false, error: "SMTP 550" }) })).failed, 1);
  assert.equal((await db.notificationLog.findUniqueOrThrow({ where: { id: row.id } })).status, "FAILED");

  row = await queue({ attempts: 3 });
  assert.equal((await run({ send: async () => { throw new Error("test"); } })).failed, 1, "Internal failures must have a bounded retry count");
  await queue({ attempts: 4, status: "SENDING", updatedAt: new Date(0) });
  assert.equal((await run()).failed, 1, "An exhausted stale claim must not send again");

  const line = await queue({ channel: "LINE", status: "SENDING", updatedAt: new Date(0) });
  await queue({ status: "SENDING", updatedAt: new Date(0) });
  assert.equal((await run()).sent, 1, "Recover an interrupted SMTP delivery");
  assert.equal((await db.notificationLog.findUniqueOrThrow({ where: { id: line.id } })).status, "SENDING", "EMAIL worker must not recover LINE claims");

  await db.registrant.update({ where: { id: person.id }, data: { emailNotifiedHash: null } });
  await queue(); assert.equal((await run({ enabled: false })).skipped, 1);
  await queue(); assert.equal((await run({ origin: null })).failed, 1);
  // LINE as the channel but not connected (any address on file still works): email carries the result.
  await db.registrant.update({ where: { id: person.id }, data: { notifyVia: "LINE" } });
  await queue(); assert.equal((await run()).sent, 1, "LINE choosers who never connected LINE get email");
  // Connected LINE: email stays quiet except as the fallback for a failed LINE push.
  await db.registrant.update({ where: { id: person.id }, data: { lineUserId: `U${"1".repeat(32)}`, emailNotifiedHash: null } });
  row = await queue(); assert.equal((await run()).skipped, 1);
  assert.equal((await db.notificationLog.findUniqueOrThrow({ where: { id: row.id } })).error, "SENT_VIA_LINE");
  await queue({ kind: "fallback" }); assert.equal((await run()).sent, 1, "LINE-only recipients receive fallback email");
  // Organizer resend: goes out although nothing changed and LINE is the channel; three per hour.
  const sentBefore = delivered.length;
  await queue({ kind: "resend" }); assert.equal((await run()).sent, 1, "A resend is sent even when the result is unchanged");
  assert.equal(delivered.length, sentBefore + 1);
  const { queueEmailResend } = await import("../src/server/email/notifications.ts");
  await db.notificationLog.deleteMany({ where: { registrantId: person.id, kind: "resend" } });
  for (let attempt = 1; attempt <= 4; attempt++) assert.equal(await queueEmailResend({ id: person.id, eventId }), attempt <= 3 ? "queued" : "rate-limited", `resend ${attempt}`);
  // Simultaneous clicks with two resends already this hour: exactly one more gets through.
  await db.notificationLog.deleteMany({ where: { registrantId: person.id, kind: "resend" } });
  await queueEmailResend({ id: person.id, eventId }); await queueEmailResend({ id: person.id, eventId });
  const together = await Promise.all(Array.from({ length: 4 }, () => queueEmailResend({ id: person.id, eventId })));
  assert.equal(together.filter((outcome) => outcome === "queued").length, 1, `Concurrent resends passed the limit: ${together}`);
  await db.notificationLog.updateMany({ where: { registrantId: person.id, status: "QUEUED" }, data: { status: "SKIPPED" } });
  await db.registrant.update({ where: { id: person.id }, data: { anonymizedAt: new Date(), email: null } });
  await queue({ kind: "fallback" }); assert.equal((await run()).skipped, 1);
  console.log("Email integration passed: concurrent claims, QR, state deduplication, retry/backoff, permanent errors, crash recovery, channel isolation, switch, fallback and privacy. No real email sent.");
} finally {
  if (eventId) await db.event.delete({ where: { id: eventId } });
  await db.$disconnect();
}
