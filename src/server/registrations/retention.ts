import { randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import { readFileAnswers } from "@/features/events/registration-fields";
import { db } from "@/server/db";
import { coverThumbKey } from "@/features/events/cover-url";
import { deleteStoredFiles, listStoredFiles } from "@/server/registrations/file-store";
import { deleteLocalRegistrationFiles } from "@/server/registrations/local-files";
import { fileStorageReady } from "@/server/registrations/upload-storage";
import { hashBearerCode } from "@/server/registrations/registration";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

/** The date after which an event's personal data must be anonymized (last event day + retentionDays). */
export function retentionDueAt(lastDay: Date, retentionDays: number) {
  return new Date(lastDay.getTime() + (retentionDays + 1) * DAY_MS);
}

/**
 * Deletes stored files nothing refers to any more: left by a crash between writing a file and saving its row, a failed
 * delete, or rows removed by hand. Only files older than a day, so an upload still being saved is never touched; covers
 * (and thumbnails) of every event, deleted ones included, and every registrant's attachments count as referenced.
 *
 * Off unless ORPHAN_FILE_SWEEP="true" ("disabled"). It deletes whatever this database does not know, so it is only safe
 * when UPLOAD_DIR belongs to this system alone — never a folder shared with staging, a copy of this database, or another
 * install. That cannot be detected reliably, so the operator states it by switching the sweep on (see OPERATIONS.md).
 */
export async function sweepOrphanFiles(now = new Date()): Promise<number | "disabled"> {
  if (process.env.ORPHAN_FILE_SWEEP !== "true") return "disabled";
  if (!fileStorageReady()) return 0;
  const candidates = (await listStoredFiles()).filter((file) => now.getTime() - file.modifiedAt.getTime() > DAY_MS);
  if (!candidates.length) return 0;
  const referenced = new Set<string>();
  for (const event of await db.event.findMany({ where: { coverImageKey: { not: null } }, select: { coverImageKey: true } })) {
    referenced.add(event.coverImageKey!);
    const thumb = coverThumbKey(event.coverImageKey!);
    if (thumb) referenced.add(thumb);
  }
  // Only registrants whose answers hold an upload come back (MySQL searches the JSON), so most rows never leave the DB.
  for (let cursor = ""; ;) {
    const batch = await db.$queryRaw<{ id: string; answers: unknown }[]>`
      SELECT id, answers FROM Registrant
      WHERE anonymizedAt IS NULL AND id > ${cursor} AND JSON_SEARCH(answers, 'one', '%', NULL, '$**.storageKey') IS NOT NULL
      ORDER BY id LIMIT ${BATCH}`;
    for (const person of batch) for (const key of fileKeys(typeof person.answers === "string" ? JSON.parse(person.answers) : person.answers)) referenced.add(key);
    if (batch.length < BATCH) break;
    cursor = batch[batch.length - 1].id;
  }
  const orphans = candidates.filter((file) => !referenced.has(file.key)).map((file) => file.key);
  await deleteStoredFiles(orphans);
  return orphans.length;
}

/** Every stored upload in an answers object: single-file objects, multi-file arrays, and keys of fields removed from the form. */
export function fileKeys(answers: unknown) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return [];
  return Object.values(answers as Record<string, unknown>).flatMap((value) => readFileAnswers(value).map((file) => file.storageKey));
}

/** Registrant columns after anonymization: answers, contact details (email, LINE), consent IP, reasons, QR and status link go. */
export function anonymizedRegistrantData(now: Date) {
  return {
    answers: {}, displayName: null, email: null, dedupeKey: null, lineUserId: null, lineNotifiedDays: Prisma.DbNull, notifyVia: "EMAIL" as const, consentIp: null, rejectReason: null, qrCode: null,
    statusTokenHash: hashBearerCode(randomBytes(32).toString("base64url")), emailNotifiedHash: null, anonymizedAt: now,
  };
}

/**
 * PDPA retention: once an event's retention period has passed, strip personal data from its registrants
 * (answers, contact details, consent IP, reasons, QR and status link) and delete their uploads.
 * Statuses, day rows and check-in records stay so anonymous statistics remain available.
 */
export async function anonymizeExpiredEvents(now = new Date()) {
  const candidates = await db.event.findMany({
    where: { anonymizedAt: null, days: { some: {} } },
    select: { id: true, retentionDays: true, days: { select: { date: true }, orderBy: { date: "desc" }, take: 1 } },
  });
  const due = candidates.filter((event) => event.days[0] && retentionDueAt(event.days[0].date, event.retentionDays) <= now);
  let anonymizedRegistrants = 0;
  for (const event of due) {
    let eventCount = 0;
    for (;;) {
      const batch = await db.registrant.findMany({ where: { eventId: event.id, anonymizedAt: null }, select: { id: true, answers: true }, take: BATCH });
      if (!batch.length) break;
      await db.$transaction(batch.map((person) => db.registrant.update({
        where: { id: person.id },
        data: anonymizedRegistrantData(now),
      })));
      await deleteLocalRegistrationFiles(batch.flatMap((person) => fileKeys(person.answers)));
      eventCount += batch.length;
    }
    await db.$transaction([
      db.event.update({ where: { id: event.id }, data: { anonymizedAt: now } }),
      db.auditLog.create({ data: { eventId: event.id, actorId: null, action: "RETENTION_ANONYMIZED", target: event.id, metadata: { registrants: eventCount, retentionDays: event.retentionDays } } }),
    ]);
    anonymizedRegistrants += eventCount;
  }
  return { checkedEvents: candidates.length, anonymizedEvents: due.length, anonymizedRegistrants };
}
