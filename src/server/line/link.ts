import { Prisma } from "@prisma/client";

import { db } from "@/server/db";
import { lineConfigured } from "@/server/line/client";
import { queueLineNotification } from "@/server/line/notifications";
import { statusTokenWhere } from "@/server/registrations/status-token";
import { isFeatureEnabled } from "@/server/settings/features";

/** LINE is offered only when the admin switch is on and both channels have their keys. */
export async function lineAvailable() {
  return lineConfigured() && await isFeatureEnabled("lineLogin");
}

/** The registrant behind a status link, if they may (dis)connect LINE: event live, not anonymised, not cancelled/rejected. */
export async function lineLinkTarget(slug: string, token: string) {
  const registrant = await db.registrant.findUnique({
    where: await statusTokenWhere(token),
    select: { id: true, eventId: true, status: true, anonymizedAt: true, lineUserId: true, event: { select: { slug: true, deletedAt: true } } },
  });
  if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt || registrant.anonymizedAt) return null;
  return registrant;
}

/** Stores the verified LINE user and queues a first message with the current status. */
export async function linkLineAccount(registrantId: string, lineUserId: string) {
  await db.$transaction(async (tx) => {
    const person = await tx.registrant.update({
      where: { id: registrantId },
      data: { lineUserId, notifyVia: "BOTH", lineNotifiedDays: Prisma.DbNull },
      select: { id: true, eventId: true },
    });
    await queueLineNotification(tx, person, "linked");
  });
}

export async function unlinkLineAccount(registrant: { id: string; eventId: string }) {
  await db.$transaction([
    db.registrant.update({ where: { id: registrant.id }, data: { lineUserId: null, notifyVia: "EMAIL", lineNotifiedDays: Prisma.DbNull } }),
    db.notificationLog.updateMany({ where: { registrantId: registrant.id, channel: "LINE", status: "QUEUED" }, data: { status: "SKIPPED", error: "ผู้สมัครเลิกรับทาง LINE" } }),
  ]);
}
