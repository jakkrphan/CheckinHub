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
  const pending = await tx.notificationLog.findFirst({ where: { registrantId: person.id, channel: "EMAIL", status: "QUEUED" }, select: { id: true } });
  if (!pending) await tx.notificationLog.create({ data: { eventId: person.eventId, registrantId: person.id, channel: "EMAIL", kind, retryKey: randomUUID() } });
  else if (kind === "fallback") await tx.notificationLog.update({ where: { id: pending.id }, data: { kind } });
  try { after(() => processEmailNotifications(10, person.id)); } catch { /* Outside requests the maintenance job delivers. */ }
}

export async function processEmailNotifications(limit = 25, registrantId?: string) {
  return processEmailQueue(db, { enabled: await isFeatureEnabled("emailNotifications"), origin: emailOrigin(), statusToken: lineStatusToken }, limit, registrantId);
}
