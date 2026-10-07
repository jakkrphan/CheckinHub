import { randomUUID } from "node:crypto";

import { after } from "next/server";

import { db } from "@/server/db";
import { emailConfigured } from "@/server/email/client";
import { processEmailNotifications } from "@/server/email/notifications";
import { lineAvailable } from "@/server/line/link";
import { processLineNotifications } from "@/server/line/notifications";
import { isFeatureEnabled } from "@/server/settings/features";

import { AUDIENCE_STATUSES, type AudienceStatus, channelsFor, countReach, DAILY_LIMIT, type Reach } from "./audience";

// Organizer announcements (spec: broadcast). One Announcement row keeps the message; every recipient gets a
// NotificationLog row (kind "announcement") on their own channel, delivered by the same outboxes as status messages:
// retries, LINE → email fallback and the /api/jobs/notifications job all apply.

const recipientWhere = (eventId: string, statuses: readonly AudienceStatus[]) => ({ eventId, anonymizedAt: null, status: { in: [...statuses] } });
const contactSelect = { id: true, status: true, email: true, lineUserId: true, notifyVia: true } as const;

/** How many people each status would reach, and on which channel, for the compose form. */
export async function announcementReach(eventId: string) {
  const [lineOn, emailOn] = await Promise.all([lineAvailable(), emailEnabled()]);
  const people = await db.registrant.findMany({ where: recipientWhere(eventId, AUDIENCE_STATUSES), select: contactSelect });
  const byStatus = Object.fromEntries(AUDIENCE_STATUSES.map((status) => [status, countReach(people.filter((person) => person.status === status), lineOn)])) as Record<AudienceStatus, Reach>;
  return { byStatus, lineOn, emailOn };
}

async function emailEnabled() {
  return emailConfigured() && await isFeatureEnabled("emailNotifications");
}

export type SendResult =
  | { ok: true; announcementId: string; reach: Reach }
  | { ok: false; reason: "no-recipients" | "duplicate" | "limit" };

export async function sendAnnouncement(input: { eventId: string; authorId: string; subject: string; body: string; audience: AudienceStatus[] }): Promise<SendResult> {
  const lineOn = await lineAvailable();
  const result = await db.$transaction(async (tx): Promise<SendResult> => {
    // One announcement per event at a time: the limit and duplicate checks below cannot be raced by a double click.
    await tx.$queryRaw`SELECT id FROM Event WHERE id = ${input.eventId} FOR UPDATE`;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await tx.announcement.findMany({ where: { eventId: input.eventId, createdAt: { gte: since } }, select: { subject: true, body: true, createdAt: true } });
    if (recent.some((item) => item.subject === input.subject && item.body === input.body && item.createdAt.getTime() > Date.now() - 10 * 60 * 1000)) return { ok: false, reason: "duplicate" };
    if (recent.length >= DAILY_LIMIT) return { ok: false, reason: "limit" };
    const people = await tx.registrant.findMany({ where: recipientWhere(input.eventId, input.audience), select: contactSelect });
    const reach = countReach(people, lineOn);
    if (reach.line + reach.email === 0) return { ok: false, reason: "no-recipients" };
    const announcement = await tx.announcement.create({ data: { eventId: input.eventId, authorId: input.authorId, subject: input.subject, body: input.body, audience: input.audience, unreachable: reach.unreachable } });
    await tx.notificationLog.createMany({ data: people.flatMap((person) => {
      const channels = channelsFor(person, lineOn);
      const row = { eventId: input.eventId, registrantId: person.id, kind: "announcement", announcementId: announcement.id };
      return [
        ...(channels.line ? [{ ...row, channel: "LINE" as const, retryKey: randomUUID() }] : []),
        ...(channels.email ? [{ ...row, channel: "EMAIL" as const, retryKey: randomUUID() }] : []),
      ];
    }) });
    // Counts only: no names or addresses in the audit trail.
    await tx.auditLog.create({ data: { eventId: input.eventId, actorId: input.authorId, action: "ANNOUNCEMENT_SENT", target: announcement.id, metadata: { audience: input.audience, ...reach } } });
    return { ok: true, announcementId: announcement.id, reach };
  });
  if (result.ok) scheduleAnnouncementDelivery();
  return result;
}

const DRAIN_BUDGET_MS = 4 * 60 * 1000;

/** Sends right after the response, batch after batch; whatever is left (or retried) goes with the notifications job. */
function scheduleAnnouncementDelivery() {
  try {
    after(async () => {
      const started = Date.now();
      while (Date.now() - started < DRAIN_BUDGET_MS) {
        const line = await processLineNotifications(25);
        const email = await processEmailNotifications(25);
        const handled = line.sent + line.failed + line.skipped + email.sent + email.failed + email.skipped;
        if (!handled) break;
      }
    });
  } catch { /* not in a request scope: the notifications job delivers */ }
}

/** Sent announcements, newest first, with how far delivery has got on each channel. */
export async function announcementHistory(eventId: string) {
  const announcements = await db.announcement.findMany({
    where: { eventId }, orderBy: { createdAt: "desc" }, take: 50,
    select: { id: true, subject: true, body: true, audience: true, unreachable: true, createdAt: true, author: { select: { name: true, email: true } } },
  });
  const counts = announcements.length ? await db.notificationLog.groupBy({ by: ["announcementId", "channel", "status"], where: { announcementId: { in: announcements.map((item) => item.id) } }, _count: { _all: true } }) : [];
  return announcements.map((announcement) => {
    const rows = counts.filter((row) => row.announcementId === announcement.id);
    const tally = (channel: "LINE" | "EMAIL") => {
      const of = (statuses: string[]) => rows.filter((row) => row.channel === channel && statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
      return { sent: of(["SENT"]), pending: of(["QUEUED", "SENDING"]), failed: of(["FAILED"]), skipped: of(["SKIPPED"]) };
    };
    return { ...announcement, audience: (Array.isArray(announcement.audience) ? announcement.audience : []) as AudienceStatus[], line: tally("LINE"), email: tally("EMAIL") };
  });
}

/** A whole-course day was added or removed after the last announcement: the spec requires telling the participants. */
export async function pendingScheduleChange(eventId: string) {
  const [change, last] = await Promise.all([
    db.auditLog.findFirst({ where: { eventId, action: { in: ["WHOLE_COURSE_DAY_ADDED_BROADCAST_REQUIRED", "WHOLE_COURSE_DAY_REMOVED_BROADCAST_REQUIRED"] } }, orderBy: { createdAt: "desc" }, select: { action: true, createdAt: true } }),
    db.announcement.findFirst({ where: { eventId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  if (!change || (last && last.createdAt >= change.createdAt)) return null;
  return { change: change.action.includes("ADDED") ? "added" as const : "removed" as const, at: change.createdAt };
}
