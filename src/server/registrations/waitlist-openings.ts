import { db } from "@/server/db";
import { getSeatAvailability } from "@/server/registrations/day-status";

export type WaitlistOpening = {
  /** null = the whole-course queue. */
  eventDayId: string | null;
  label: string;
  /** Free seats; null = no seat limit. */
  free: number | null;
  waiting: number;
  next: { id: string; name: string };
};

const dayFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Queues that could move right now (spec 1.7, `waitlistPromotion = manual`): a free seat and someone waiting.
 * Automatic events fill seats on their own, so this returns nothing for them.
 */
export async function getWaitlistOpenings(event: { id: string; status: string; seatMode: string; maxSeats: number | null; waitlistPromotion: string }): Promise<WaitlistOpening[]> {
  if (event.status !== "PUBLISHED" || event.waitlistPromotion !== "MANUAL") return [];
  const nameOf = (person: { id: string; displayName: string | null; email: string | null }) => ({ id: person.id, name: person.displayName ?? person.email ?? "ผู้ลงทะเบียน" });

  if (event.seatMode === "whole_course") {
    const waiting = await db.registrant.count({ where: { eventId: event.id, status: "WAITLISTED" } });
    if (!waiting) return [];
    const availability = await getSeatAvailability(db, event, []);
    if (availability.mode !== "whole_course" || availability.remaining === 0) return [];
    const nextRow = await db.registrantEventDay.findFirst({ where: { status: "WAITLISTED", eventDay: { eventId: event.id }, registrant: { status: "WAITLISTED" } }, orderBy: [{ waitlistedAt: "asc" }, { id: "asc" }], select: { registrant: { select: { id: true, displayName: true, email: true } } } });
    return nextRow ? [{ eventDayId: null, label: "ทั้งหลักสูตร", free: availability.remaining, waiting, next: nameOf(nextRow.registrant) }] : [];
  }

  const queued = await db.registrantEventDay.groupBy({ by: ["eventDayId"], where: { status: "WAITLISTED", eventDay: { eventId: event.id, isClosed: false } }, _count: { _all: true } });
  if (!queued.length) return [];
  const days = await db.eventDay.findMany({ where: { eventId: event.id }, orderBy: { date: "asc" }, select: { id: true, date: true } });
  const availability = await getSeatAvailability(db, event, queued.map((row) => row.eventDayId));
  const openings: WaitlistOpening[] = [];
  for (const [index, day] of days.entries()) {
    const waiting = queued.find((row) => row.eventDayId === day.id)?._count._all ?? 0;
    const free = availability.mode === "per_day" ? availability.days.get(day.id)?.remaining : undefined;
    if (!waiting || free === undefined || free === 0) continue;
    const next = await db.registrantEventDay.findFirst({ where: { eventDayId: day.id, status: "WAITLISTED" }, orderBy: [{ waitlistedAt: "asc" }, { id: "asc" }], select: { registrant: { select: { id: true, displayName: true, email: true } } } });
    if (next) openings.push({ eventDayId: day.id, label: `วันที่ ${index + 1} · ${dayFormatter.format(day.date)}`, free, waiting, next: nameOf(next.registrant) });
  }
  return openings;
}
