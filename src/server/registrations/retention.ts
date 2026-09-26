import { randomBytes } from "node:crypto";

import { readFileAnswers } from "@/features/events/registration-fields";
import { db } from "@/server/db";
import { deleteLocalRegistrationFiles } from "@/server/registrations/local-files";
import { hashBearerCode } from "@/server/registrations/registration";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

/** The date after which an event's personal data must be anonymized (last event day + retentionDays). */
export function retentionDueAt(lastDay: Date, retentionDays: number) {
  return new Date(lastDay.getTime() + (retentionDays + 1) * DAY_MS);
}

/** Every stored upload in an answers object: single-file objects, multi-file arrays, and keys of fields removed from the form. */
function fileKeys(answers: unknown) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return [];
  return Object.values(answers as Record<string, unknown>).flatMap((value) => readFileAnswers(value).map((file) => file.storageKey));
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
        data: {
          answers: {}, email: null, dedupeKey: null, lineUserId: null, consentIp: null, rejectReason: null, qrCode: null,
          statusTokenHash: hashBearerCode(randomBytes(32).toString("base64url")), anonymizedAt: now,
        },
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
