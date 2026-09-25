import type { RegistrantStatus } from "@prisma/client";

import { db } from "@/server/db";

export type SessionProgress = { id: string; label: string; startTime: Date | null; endTime: Date | null; checkedIn: number; expected: number };
export type DayOverview = { id: string; date: Date; maxSeats: number | null; isClosed: boolean; occupied: number; approved: number; waitlisted: number; sessions: SessionProgress[] };
export type EventOverview = Awaited<ReturnType<typeof getEventOverview>>;

/**
 * Registration and attendance numbers shared by the organizer dashboard and the admin event view.
 * A session's expected count is the approved people for its day (per_day) or for the whole course / event
 * (whole_course and every-day sessions), matching the spec's dashboard denominators.
 */
export async function getEventOverview(event: { id: string; seatMode: string; maxSeats: number | null; attendanceThreshold: number | null }) {
  const [statusRows, days, sessions, dayRows] = await Promise.all([
    db.registrant.groupBy({ by: ["status"], where: { eventId: event.id }, _count: { _all: true } }),
    db.eventDay.findMany({ where: { eventId: event.id }, orderBy: { date: "asc" }, select: { id: true, date: true, maxSeats: true, isClosed: true } }),
    db.session.findMany({
      where: { eventId: event.id }, orderBy: [{ eventDay: { date: "asc" } }, { sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true, startTime: true, endTime: true, eventDayId: true, _count: { select: { checkIns: { where: { voidedAt: null } } } } },
    }),
    db.registrantEventDay.groupBy({ by: ["eventDayId", "status"], where: { eventDay: { eventId: event.id } }, _count: { _all: true } }),
  ]);
  const status = Object.fromEntries(statusRows.map((row) => [row.status, row._count._all])) as Partial<Record<RegistrantStatus, number>>;
  const count = (key: RegistrantStatus) => status[key] ?? 0;
  const dayCount = (dayId: string, key: RegistrantStatus) => dayRows.find((row) => row.eventDayId === dayId && row.status === key)?._count._all ?? 0;
  const approvedPeople = count("APPROVED");
  const wholeCourse = event.seatMode === "whole_course";
  const toProgress = (session: (typeof sessions)[number], expected: number): SessionProgress => ({
    id: session.id, label: session.label, startTime: session.startTime, endTime: session.endTime, checkedIn: session._count.checkIns, expected,
  });

  const dayOverviews: DayOverview[] = days.map((day) => {
    const approved = dayCount(day.id, "APPROVED");
    return {
      ...day, approved,
      occupied: approved + dayCount(day.id, "PENDING"),
      waitlisted: dayCount(day.id, "WAITLISTED"),
      sessions: sessions.filter((session) => session.eventDayId === day.id).map((session) => toProgress(session, wholeCourse ? approvedPeople : approved)),
    };
  });
  const everyDaySessions = sessions.filter((session) => !session.eventDayId).map((session) => toProgress(session, approvedPeople));

  let continuity: { full: number; missOne: number; missMore: number; passed: number | null; threshold: number | null; totalSessions: number } | null = null;
  if (wholeCourse) {
    const perPerson = approvedPeople && sessions.length ? await db.checkIn.groupBy({
      by: ["registrantId"], where: { voidedAt: null, sessionId: { in: sessions.map((session) => session.id) }, registrant: { eventId: event.id, status: "APPROVED" } }, _count: { _all: true },
    }) : [];
    const attended = new Map(perPerson.map((row) => [row.registrantId, row._count._all]));
    const approvedIds = approvedPeople ? await db.registrant.findMany({ where: { eventId: event.id, status: "APPROVED" }, select: { id: true } }) : [];
    const missed = approvedIds.map(({ id }) => Math.max(0, sessions.length - (attended.get(id) ?? 0)));
    continuity = {
      full: missed.filter((value) => value === 0).length,
      missOne: missed.filter((value) => value === 1).length,
      missMore: missed.filter((value) => value >= 2).length,
      threshold: event.attendanceThreshold,
      passed: event.attendanceThreshold === null || !sessions.length ? null : approvedIds.filter(({ id }) => (attended.get(id) ?? 0) / sessions.length * 100 >= event.attendanceThreshold!).length,
      totalSessions: sessions.length,
    };
  }

  return {
    counts: { pending: count("PENDING"), approved: approvedPeople, rejected: count("REJECTED"), waitlisted: count("WAITLISTED"), cancelled: count("CANCELLED"), total: statusRows.reduce((sum, row) => sum + row._count._all, 0) },
    days: dayOverviews,
    everyDaySessions,
    course: wholeCourse ? { taken: count("PENDING") + approvedPeople, max: event.maxSeats, waitlisted: count("WAITLISTED") } : null,
    continuity,
  };
}
