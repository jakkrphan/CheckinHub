import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { after } from "next/server";

import { db } from "@/server/db";
import { emailOrigin } from "@/server/email/client";
import { processEmailQueue } from "@/server/email/delivery";
import { lineStatusToken } from "@/server/registrations/status-token";
import { isFeatureEnabled } from "@/server/settings/features";

/** Queue in the same transaction as registration/status change. Sending starts after the response. */
export async function queueEmailNotification(tx: Prisma.TransactionClient, person: { id: string; eventId: string }, kind: "status" | "fallback" = "status") {
  // A queued status email is built from the latest state when sent, so one is enough (announcements are separate messages).
  const pending = await tx.notificationLog.findFirst({ where: { registrantId: person.id, channel: "EMAIL", status: "QUEUED", kind: { not: "announcement" } }, select: { id: true } });
  if (!pending) await tx.notificationLog.create({ data: { eventId: person.eventId, registrantId: person.id, channel: "EMAIL", kind, retryKey: randomUUID() } });
  else if (kind === "fallback") await tx.notificationLog.update({ where: { id: pending.id }, data: { kind } });
  try { after(() => processEmailNotifications(10, person.id)); } catch { /* Outside requests the maintenance job delivers. */ }
}

/** An announcement by email, e.g. when its LINE push failed. One row per person per announcement. */
export async function queueEmailAnnouncement(tx: Prisma.TransactionClient, person: { id: string; eventId: string }, announcementId: string) {
  const exists = await tx.notificationLog.findFirst({ where: { registrantId: person.id, channel: "EMAIL", announcementId }, select: { id: true } });
  if (!exists) await tx.notificationLog.create({ data: { eventId: person.eventId, registrantId: person.id, channel: "EMAIL", kind: "announcement", announcementId, retryKey: randomUUID() } });
  try { after(() => processEmailNotifications(10, person.id)); } catch { /* Outside requests the maintenance job delivers. */ }
}

const RESEND_LIMIT_PER_HOUR = 3;

/** The organizer's "send the email again" (spec: resend): the current result in full, at most three per person per hour. */
export async function queueEmailResend(person: { id: string; eventId: string }) {
  // The registrant row lock makes count-then-insert atomic: two clicks at once cannot both pass the limit.
  const queued = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Registrant WHERE id = ${person.id} FOR UPDATE`;
    const recent = await tx.notificationLog.count({ where: { registrantId: person.id, channel: "EMAIL", kind: "resend", createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } });
    if (recent >= RESEND_LIMIT_PER_HOUR) return false;
    await tx.notificationLog.create({ data: { eventId: person.eventId, registrantId: person.id, channel: "EMAIL", kind: "resend", retryKey: randomUUID() } });
    return true;
  });
  if (!queued) return "rate-limited" as const;
  try { after(() => processEmailNotifications(10, person.id)); } catch { /* Outside requests the maintenance job delivers. */ }
  return "queued" as const;
}

export async function processEmailNotifications(limit = 25, registrantId?: string) {
  return processEmailQueue(db, { enabled: await isFeatureEnabled("emailNotifications"), origin: emailOrigin(), statusToken: lineStatusToken }, limit, registrantId);
}
