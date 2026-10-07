import { Prisma, type RegistrantStatus } from "@prisma/client";

import { issueQrCode } from "@/server/registrations/qr-code";

const seatStatuses: RegistrantStatus[] = ["PENDING", "APPROVED"];

export function summarizeDayStatuses(statuses: RegistrantStatus[]): RegistrantStatus {
  if (statuses.includes("APPROVED")) return "APPROVED";
  if (statuses.includes("PENDING")) return "PENDING";
  if (statuses.includes("WAITLISTED")) return "WAITLISTED";
  if (statuses.length && statuses.every((status) => status === "CANCELLED")) return "CANCELLED";
  return "REJECTED";
}

export async function seatsTaken(tx: Prisma.TransactionClient, eventDayId: string) {
  return tx.registrantEventDay.count({ where: { eventDayId, status: { in: seatStatuses } } });
}

export async function getSeatAvailability(
  tx: Prisma.TransactionClient,
  event: { id: string; seatMode: string; maxSeats: number | null },
  dayIds: string[],
) {
  if (event.seatMode === "whole_course") {
    const taken = await tx.registrant.count({ where: { eventId: event.id, status: { in: seatStatuses } } });
    return { mode: "whole_course" as const, taken, remaining: event.maxSeats === null ? null : Math.max(event.maxSeats - taken, 0) };
  }
  const days = await tx.eventDay.findMany({ where: { eventId: event.id, id: { in: dayIds } }, select: { id: true, maxSeats: true } });
  const availability = new Map<string, { taken: number; remaining: number | null }>();
  for (const day of days) {
    const taken = await seatsTaken(tx, day.id);
    availability.set(day.id, { taken, remaining: day.maxSeats === null ? null : Math.max(day.maxSeats - taken, 0) });
  }
  return { mode: "per_day" as const, days: availability };
}

export async function syncRegistrantStatus(tx: Prisma.TransactionClient, registrantId: string) {
  const person = await tx.registrant.findUniqueOrThrow({
    where: { id: registrantId },
    select: { status: true, qrCode: true, approvedAt: true, eventId: true, lineUserId: true, email: true, notifyVia: true, days: { select: { status: true } } },
  });
  const status = summarizeDayStatuses(person.days.map((day) => day.status));
  await tx.registrant.update({
    where: { id: registrantId },
    data: {
      status,
      qrCode: status === "APPROVED" ? (person.qrCode ?? await issueQrCode(tx)) : null,
      approvedAt: status === "APPROVED" ? (person.approvedAt ?? new Date()) : null,
      cancelledAt: status === "CANCELLED" ? new Date() : null,
      // Release the duplicate guard so a cancelled or rejected person can register again.
      ...(status === "CANCELLED" || status === "REJECTED" ? { dedupeKey: null } : {}),
    },
  });
  // People who connected LINE hear about the change; the message is built from what differs when it is sent.
  // Imported lazily so the seat logic (and its unit tests) does not load the LINE/Next.js server modules.
  if (person.lineUserId) {
    const { queueLineNotification } = await import("@/server/line/notifications");
    await queueLineNotification(tx, { id: registrantId, eventId: person.eventId }, "status");
  }
  if (person.email && (person.notifyVia !== "LINE" || !person.lineUserId)) {
    const { queueEmailNotification } = await import("@/server/email/notifications");
    await queueEmailNotification(tx, { id: registrantId, eventId: person.eventId });
  }
  return status;
}
