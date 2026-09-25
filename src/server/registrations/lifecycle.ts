import { Prisma } from "@prisma/client";

import { db } from "@/server/db";
import { getSeatAvailability, seatsTaken, syncRegistrantStatus } from "@/server/registrations/day-status";
import { hashBearerCode } from "@/server/registrations/registration";

export async function lockEventDays(tx: Prisma.TransactionClient, eventId: string) {
  await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
  const days = await tx.eventDay.findMany({ where: { eventId }, select: { id: true, maxSeats: true }, orderBy: { id: "asc" } });
  if (days.length) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM EventDay WHERE eventId = ${eventId} AND id IN (${Prisma.join(days.map((day) => day.id))}) ORDER BY id FOR UPDATE`);
  }
  return days;
}

export async function hasCapacity(tx: Prisma.TransactionClient, dayIds: string[], limits: Map<string, number | null>) {
  for (const dayId of dayIds) {
    const limit = limits.get(dayId);
    if (limit === undefined) return false;
    if (limit === null) continue;
    const occupied = await seatsTaken(tx, dayId);
    if (occupied >= limit) return false;
  }
  return true;
}

export async function promoteWaitlist(tx: Prisma.TransactionClient, eventId: string, excludedRowIds: string[] = []) {
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { id: true, status: true, waitlistPromotion: true, seatMode: true, maxSeats: true } });
  if (event.status !== "PUBLISHED" || event.waitlistPromotion !== "AUTO") return;
  if (event.seatMode === "whole_course") {
    await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
    const excludedPeople = excludedRowIds.length ? (await tx.registrantEventDay.findMany({ where: { id: { in: excludedRowIds } }, select: { registrantId: true } })).map((row) => row.registrantId) : [];
    while (true) {
      const availability = await getSeatAvailability(tx, event, []);
      if (availability.mode !== "whole_course" || availability.remaining === 0) break;
      const nextRow = await tx.registrantEventDay.findFirst({ where: { status: "WAITLISTED", eventDay: { eventId }, registrant: { status: "WAITLISTED", ...(excludedPeople.length ? { id: { notIn: excludedPeople } } : {}) } }, orderBy: [{ waitlistedAt: "asc" }, { id: "asc" }], select: { registrant: { select: { id: true, autoApproveAtRegistration: true } } } });
      const next = nextRow?.registrant;
      if (!next) break;
      const status = next.autoApproveAtRegistration ? "APPROVED" : "PENDING";
      await tx.registrantEventDay.updateMany({ where: { registrantId: next.id }, data: { status, waitlistedAt: null, pendingSince: status === "PENDING" ? new Date() : null } });
      await syncRegistrantStatus(tx, next.id);
    }
    return;
  }
  await lockEventDays(tx, eventId);
  const days = await tx.eventDay.findMany({ where: { eventId }, select: { id: true, maxSeats: true, isClosed: true } });
  for (const day of days) {
    if (day.isClosed) continue;
    while (day.maxSeats === null || (await seatsTaken(tx, day.id)) < day.maxSeats) {
      const next = await tx.registrantEventDay.findFirst({
        where: { eventDayId: day.id, status: "WAITLISTED", ...(excludedRowIds.length ? { id: { notIn: excludedRowIds } } : {}) },
        orderBy: [{ waitlistedAt: "asc" }, { id: "asc" }],
        select: { id: true, registrantId: true, registrant: { select: { autoApproveAtRegistration: true } } },
      });
      if (!next) break;
      await tx.registrantEventDay.update({
        where: { id: next.id },
        data: { status: next.registrant.autoApproveAtRegistration ? "APPROVED" : "PENDING", waitlistedAt: null, pendingSince: next.registrant.autoApproveAtRegistration ? null : new Date() },
      });
      await syncRegistrantStatus(tx, next.registrantId);
    }
  }
}

export async function cancelOwnRegistration(slug: string, token: string, eventDayId?: string) {
  const statusTokenHash = hashBearerCode(token);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const registrant = await tx.registrant.findUnique({
          where: { statusTokenHash },
          include: { event: { select: { id: true, slug: true, seatMode: true, deletedAt: true } } },
        });
        if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt) return "not-found" as const;
        if (["CANCELLED", "REJECTED"].includes(registrant.status)) return "cancelled" as const;
        if (eventDayId && registrant.event.seatMode === "whole_course") return "not-found" as const;
        await lockEventDays(tx, registrant.eventId);
        await tx.$queryRaw`SELECT id FROM Registrant WHERE id = ${registrant.id} FOR UPDATE`;
        const current = await tx.registrant.findUniqueOrThrow({ where: { id: registrant.id }, select: { status: true } });
        if (["CANCELLED", "REJECTED"].includes(current.status)) return "cancelled" as const;
        if (eventDayId) {
          const selected = await tx.registrantEventDay.findFirst({ where: { registrantId: registrant.id, eventDayId, status: { in: ["PENDING", "APPROVED", "WAITLISTED"] } }, select: { id: true } });
          if (!selected) return "not-found" as const;
        }
        const checkedIn = await tx.checkIn.count({ where: { registrantId: registrant.id, voidedAt: null, ...(eventDayId ? { session: { eventDayId } } : {}) } });
        if (checkedIn) return "already-checked-in" as const;
        await tx.registrantEventDay.updateMany({ where: { registrantId: registrant.id, ...(eventDayId ? { eventDayId } : {}), status: { in: ["PENDING", "APPROVED", "WAITLISTED"] } }, data: { status: "CANCELLED", waitlistedAt: null, pendingSince: null } });
        await syncRegistrantStatus(tx, registrant.id);
        await promoteWaitlist(tx, registrant.eventId);
        return "cancelled" as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "1213"))) {
        if (attempt === 4) return "unavailable" as const;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  return "unavailable" as const;
}
