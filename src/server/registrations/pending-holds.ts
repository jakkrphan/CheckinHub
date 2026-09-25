import { Prisma } from "@prisma/client";

import { db } from "@/server/db";
import { syncRegistrantStatus } from "@/server/registrations/day-status";
import { lockEventDays, promoteWaitlist } from "@/server/registrations/lifecycle";

export async function expirePendingHolds(now = new Date()) {
  const events = await db.event.findMany({
    where: { status: "PUBLISHED", deletedAt: null, pendingHoldHours: { not: null } },
    select: { id: true, pendingHoldHours: true, seatMode: true },
  });
  let expiredRows = 0;
  for (const event of events) {
    if (!event.pendingHoldHours) continue;
    const cutoff = new Date(now.getTime() - event.pendingHoldHours * 60 * 60 * 1000);
    expiredRows += await db.$transaction(async (tx) => {
      await lockEventDays(tx, event.id);
      const rows = await tx.registrantEventDay.findMany({
        where: { status: "PENDING", pendingSince: { lte: cutoff }, registrant: { eventId: event.id } },
        orderBy: [{ pendingSince: "asc" }, { id: "asc" }],
        take: 500,
        select: { id: true, registrantId: true },
      });
      const affectedPeople = new Set<string>();
      const expiredIds: string[] = [];
      if (event.seatMode === "whole_course") {
        for (const registrantId of new Set(rows.map((row) => row.registrantId))) {
          const updated = await tx.registrantEventDay.updateMany({ where: { registrantId, status: "PENDING" }, data: { status: "WAITLISTED", pendingSince: null, waitlistedAt: now } });
          if (updated.count) affectedPeople.add(registrantId);
        }
        for (const registrantId of affectedPeople) await syncRegistrantStatus(tx, registrantId);
        if (affectedPeople.size) await promoteWaitlist(tx, event.id, rows.map((row) => row.id));
        return affectedPeople.size;
      }
      for (const row of rows) {
        const updated = await tx.registrantEventDay.updateMany({
          where: { id: row.id, status: "PENDING", pendingSince: { lte: cutoff } },
          data: { status: "WAITLISTED", pendingSince: null, waitlistedAt: now },
        });
        if (updated.count) { affectedPeople.add(row.registrantId); expiredIds.push(row.id); }
      }
      for (const registrantId of affectedPeople) await syncRegistrantStatus(tx, registrantId);
      if (expiredIds.length) await promoteWaitlist(tx, event.id, expiredIds);
      return expiredIds.length;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  return { checkedEvents: events.length, expiredRows };
}
