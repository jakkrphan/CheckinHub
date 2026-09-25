"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireEventAccess } from "@/server/authorization/event";
import { requiresAdminAudit } from "@/server/authorization/policy";
import { db } from "@/server/db";
import { promoteWaitlist } from "@/server/registrations/lifecycle";

const maxSeatsInput = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.coerce.number().int().min(1).max(1000000).nullable(),
);

const dayInput = z.object({
  date: z.iso.date(),
  maxSeats: maxSeatsInput,
  isClosed: z.boolean(),
});

const sessionInput = z.object({
  label: z.string().trim().min(1).max(191),
});

function eventUrl(eventId: string, message: string) {
  return `/organizer/${eventId}?${message}`;
}

async function auditAdminChange(
  tx: Prisma.TransactionClient,
  eventId: string,
  actorId: string,
  action: string,
  target: string,
) {
  await tx.auditLog.create({
    data: { eventId, actorId, action, target },
  });
}

export async function addEventDays(eventId: string, formData: FormData) {
  const { membership, user } = await requireEventAccess(eventId, "manage");
  const parsed = z.object({
    dates: z.array(z.iso.date()).min(1).max(60),
    maxSeats: dayInput.shape.maxSeats,
  }).safeParse({
    dates: formData.getAll("dates"),
    maxSeats: formData.get("maxSeats"),
  });

  if (!parsed.success) redirect(eventUrl(eventId, "error=invalid-day"));

  const uniqueDates = new Set(parsed.data.dates);
  const dates = parsed.data.dates.map((value) => new Date(`${value}T00:00:00.000Z`));
  if (uniqueDates.size !== dates.length || dates.some((date, index) => Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== parsed.data.dates[index])) {
    redirect(eventUrl(eventId, "error=invalid-day"));
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { seatMode: true, status: true } });
      for (const date of dates) {
        const day = await tx.eventDay.create({
          data: { eventId, date, maxSeats: event.seatMode === "whole_course" ? null : parsed.data.maxSeats },
        });
        if (event.seatMode === "whole_course" && event.status === "PUBLISHED") {
          const people = await tx.registrant.findMany({ where: { eventId }, select: { id: true, status: true } });
          if (people.length) await tx.registrantEventDay.createMany({ data: people.map((person) => ({ registrantId: person.id, eventDayId: day.id, status: person.status, pendingSince: person.status === "PENDING" ? new Date() : null, waitlistedAt: person.status === "WAITLISTED" ? new Date() : null })) });
          await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "WHOLE_COURSE_DAY_ADDED_BROADCAST_REQUIRED", target: day.id, metadata: { affectedRegistrants: people.length } } });
        }
        if (requiresAdminAudit(membership)) {
          await auditAdminChange(tx, eventId, user.id, "EVENT_DAY_ADDED_BY_ADMIN", day.id);
        }
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect(eventUrl(eventId, "error=duplicate-day"));
    }
    throw error;
  }

  revalidatePath(`/organizer/${eventId}`);
  revalidatePath("/organizer");
  redirect(eventUrl(eventId, "saved=day"));
}

export async function removeEventDay(eventId: string, dayId: string, formData: FormData) {
  const { membership, user, event } = await requireEventAccess(eventId, "manage");

  const removed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
    if (event.seatMode === "whole_course") {
      if (formData.get("confirm") !== "on") return 0;
      const day = await tx.eventDay.findFirst({ where: { id: dayId, eventId }, select: { id: true, _count: { select: { registrantDays: true, sessions: true } } } });
      if (!day || await tx.eventDay.count({ where: { eventId } }) <= 1 || await tx.checkIn.count({ where: { session: { eventDayId: dayId } } })) return 0;
      await tx.eventDay.delete({ where: { id: dayId } });
      await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "WHOLE_COURSE_DAY_REMOVED_BROADCAST_REQUIRED", target: dayId, metadata: { affectedRegistrants: day._count.registrantDays, removedSessions: day._count.sessions } } });
      return 1;
    }
    const result = await tx.eventDay.deleteMany({
      where: {
        id: dayId,
        eventId,
        registrantDays: { none: {} },
        sessions: { none: {} },
      },
    });
    if (result.count && requiresAdminAudit(membership)) {
      await auditAdminChange(tx, eventId, user.id, "EVENT_DAY_REMOVED_BY_ADMIN", dayId);
    }
    return result.count;
  });

  if (!removed) redirect(eventUrl(eventId, "error=day-in-use"));
  revalidatePath(`/organizer/${eventId}`);
  revalidatePath("/organizer");
  redirect(eventUrl(eventId, "saved=day"));
}

export async function updateEventDay(eventId: string, dayId: string, formData: FormData) {
  const { membership, user, event } = await requireEventAccess(eventId, "manage");
  const parsed = dayInput.safeParse({ date: formData.get("date"), maxSeats: formData.get("maxSeats"), isClosed: formData.get("isClosed") === "on" });
  if (!parsed.success) redirect(eventUrl(eventId, "error=invalid-day"));
  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== parsed.data.date) redirect(eventUrl(eventId, "error=invalid-day"));
  let failure: string | null = null;
  try { await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM EventDay WHERE id = ${dayId} AND eventId = ${eventId} FOR UPDATE`;
    const day = await tx.eventDay.findFirst({ where: { id: dayId, eventId }, select: { date: true, registrantDays: { select: { id: true }, take: 1 } } });
    if (!day) { failure = "invalid-day"; return; }
    if (day.registrantDays.length && date.valueOf() !== day.date.valueOf()) { failure = "day-in-use"; return; }
    const occupied = await tx.registrantEventDay.count({ where: { eventDayId: dayId, status: { in: ["PENDING", "APPROVED"] } } });
    if (parsed.data.maxSeats !== null && parsed.data.maxSeats < occupied) { failure = "invalid-day"; return; }
    await tx.eventDay.update({ where: { id: dayId }, data: { date, maxSeats: event.seatMode === "whole_course" ? null : parsed.data.maxSeats, isClosed: event.seatMode === "whole_course" ? false : parsed.data.isClosed } });
    if (!parsed.data.isClosed) await promoteWaitlist(tx, eventId);
    if (requiresAdminAudit(membership)) await auditAdminChange(tx, eventId, user.id, "EVENT_DAY_UPDATED_BY_ADMIN", dayId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }); }
  catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") redirect(eventUrl(eventId, "error=duplicate-day")); throw error; }
  if (failure) redirect(eventUrl(eventId, `error=${failure}`));
  revalidatePath(`/organizer/${eventId}`);
  redirect(eventUrl(eventId, "saved=day"));
}

/**
 * Staff pick sessions by label, so a label may repeat only across different days.
 * A session that applies to every day must not share its label with any other session.
 */
async function sessionLabelTaken(tx: Prisma.TransactionClient, eventId: string, eventDayId: string | null, label: string, excludeId?: string) {
  const clash = await tx.session.findFirst({
    where: { eventId, label, ...(excludeId ? { id: { not: excludeId } } : {}), ...(eventDayId ? { OR: [{ eventDayId }, { eventDayId: null }] } : {}) },
    select: { id: true },
  });
  return !!clash;
}

/** New sessions go to the end of the event's display order. */
async function nextSortOrder(tx: Prisma.TransactionClient, eventId: string) {
  const last = await tx.session.aggregate({ where: { eventId }, _max: { sortOrder: true } });
  return (last._max.sortOrder ?? 0) + 1;
}

export async function removeSession(eventId: string, sessionId: string, formData?: FormData) {
  const { membership, user } = await requireEventAccess(eventId, "manage");
  // Removing a session deletes its check-in history, so that case needs an explicit confirmation and is always audited.
  const confirmed = formData?.get("confirmCheckIns") === "on";
  const removed = await db.$transaction(async (tx) => {
    const session = await tx.session.findFirst({ where: { id: sessionId, eventId }, select: { label: true, _count: { select: { checkIns: true } } } });
    if (!session) return false;
    const activeCheckIns = await tx.checkIn.count({ where: { sessionId, voidedAt: null } });
    if (activeCheckIns && !confirmed) return false;
    await tx.session.delete({ where: { id: sessionId } });
    if (session._count.checkIns) {
      await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "EVENT_SESSION_REMOVED_WITH_CHECKINS", target: sessionId, metadata: { label: session.label, checkInRecords: session._count.checkIns } } });
    } else if (requiresAdminAudit(membership)) {
      await auditAdminChange(tx, eventId, user.id, "EVENT_SESSION_REMOVED_BY_ADMIN", sessionId);
    }
    return true;
  });

  if (!removed) redirect(sessionUrl(eventId, sessionId, "error=session-in-use"));
  revalidatePath(`/organizer/${eventId}`);
  redirect(sessionUrl(eventId, undefined, "saved=session"));
}

/** Moves a session one place within its own day (or within the every-day group); sessions sort by day first. */
export async function moveSession(eventId: string, sessionId: string, direction: "up" | "down") {
  const { membership, user } = await requireEventAccess(eventId, "manage");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
    const target = await tx.session.findFirst({ where: { id: sessionId, eventId }, select: { eventDayId: true } });
    if (!target) return;
    const group = await tx.session.findMany({ where: { eventId, eventDayId: target.eventDayId }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }, { id: "asc" }], select: { id: true, sortOrder: true } });
    const index = group.findIndex((item) => item.id === sessionId);
    const swapWith = index + (direction === "up" ? -1 : 1);
    if (swapWith < 0 || swapWith >= group.length) return;
    // Renumber the group from its current slots so ties from older data cannot block the swap.
    const slots = group.map((item) => item.sortOrder).sort((a, b) => a - b).map((value, position, all) => position > 0 && value <= all[position - 1] ? all[position - 1] + 1 : value);
    const reordered = [...group];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
    for (const [position, item] of reordered.entries()) await tx.session.update({ where: { id: item.id }, data: { sortOrder: slots[position] } });
    if (requiresAdminAudit(membership)) await auditAdminChange(tx, eventId, user.id, "EVENT_SESSION_MOVED_BY_ADMIN", sessionId);
  });
  revalidatePath(`/organizer/${eventId}`);
  redirect(sessionUrl(eventId, sessionId, "saved=session"));
}

const timeInput = z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]);

/** Session times are clock times in Bangkok; they are stored on the session's day (or 1970-01-01 for every-day sessions). */
function sessionTime(day: Date | null, value: string) {
  if (!value) return null;
  const date = day ? day.toISOString().slice(0, 10) : "1970-01-01";
  return new Date(`${date}T${value}:00+07:00`);
}

const bangkokClock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
const clockOf = (value: Date | null) => value ? bangkokClock.format(value) : "";

function sessionUrl(eventId: string, sessionId: string | undefined, message: string) {
  return `/organizer/${eventId}?step=4&${message}${sessionId ? `&session=${sessionId}` : ""}`;
}

/**
 * Creates (sessionId = null) or edits a session: label, day binding and optional start/end time.
 * A session that already has check-ins cannot move to another day, since that would change who it applies to.
 */
export async function saveSession(eventId: string, sessionId: string | null, formData: FormData) {
  const { membership, user } = await requireEventAccess(eventId, "manage");
  const parsed = z.object({ label: sessionInput.shape.label, scope: z.string().min(1).max(64), start: timeInput, end: timeInput }).safeParse({
    label: formData.get("label"), scope: formData.get("scope"), start: formData.get("start") ?? "", end: formData.get("end") ?? "",
  });
  if (!parsed.success) redirect(sessionUrl(eventId, sessionId ?? undefined, "error=invalid-session"));
  if (parsed.data.start && parsed.data.end && parsed.data.end <= parsed.data.start) redirect(sessionUrl(eventId, sessionId ?? undefined, "error=invalid-session-time"));

  if (!sessionId && parsed.data.scope === "EACH_DAY") {
    // One session per event day with the same label and clock times; all-or-nothing if any day already uses the label.
    const created = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
      const days = await tx.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true, date: true } });
      if (!days.length) return null;
      for (const day of days) if (await sessionLabelTaken(tx, eventId, day.id, parsed.data.label)) return null;
      for (const day of days) {
        const session = await tx.session.create({ data: { eventId, eventDayId: day.id, label: parsed.data.label, startTime: sessionTime(day.date, parsed.data.start), endTime: sessionTime(day.date, parsed.data.end), sortOrder: await nextSortOrder(tx, eventId) }, select: { id: true } });
        if (requiresAdminAudit(membership)) await auditAdminChange(tx, eventId, user.id, "EVENT_SESSION_ADDED_BY_ADMIN", session.id);
      }
      return days.length;
    });
    if (!created) redirect(sessionUrl(eventId, undefined, "error=duplicate-session"));
    revalidatePath(`/organizer/${eventId}`);
    revalidatePath("/organizer");
    redirect(sessionUrl(eventId, undefined, `saved=session&added=${created}`));
  }

  const outcome = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
    const day = parsed.data.scope === "EVENT" ? null : await tx.eventDay.findFirst({ where: { id: parsed.data.scope, eventId }, select: { id: true, date: true } });
    if (parsed.data.scope !== "EVENT" && !day) return { error: "invalid-session" } as const;
    const data = { label: parsed.data.label, eventDayId: day?.id ?? null, startTime: sessionTime(day?.date ?? null, parsed.data.start), endTime: sessionTime(day?.date ?? null, parsed.data.end) };
    if (sessionId) {
      const current = await tx.session.findFirst({ where: { id: sessionId, eventId }, select: { eventDayId: true, _count: { select: { checkIns: true } } } });
      if (!current) return { error: "invalid-session" } as const;
      if (current._count.checkIns && current.eventDayId !== data.eventDayId) return { error: "session-day-locked" } as const;
      if (await sessionLabelTaken(tx, eventId, data.eventDayId, data.label, sessionId)) return { error: "duplicate-session" } as const;
      await tx.session.update({ where: { id: sessionId }, data });
      if (requiresAdminAudit(membership)) await auditAdminChange(tx, eventId, user.id, "EVENT_SESSION_UPDATED_BY_ADMIN", sessionId);
      return { id: sessionId } as const;
    }
    if (await sessionLabelTaken(tx, eventId, data.eventDayId, data.label)) return { error: "duplicate-session" } as const;
    const created = await tx.session.create({ data: { ...data, eventId, sortOrder: await nextSortOrder(tx, eventId) }, select: { id: true } });
    if (requiresAdminAudit(membership)) await auditAdminChange(tx, eventId, user.id, "EVENT_SESSION_ADDED_BY_ADMIN", created.id);
    return { id: created.id } as const;
  });
  if ("error" in outcome) redirect(sessionUrl(eventId, sessionId ?? undefined, `error=${outcome.error}`));
  revalidatePath(`/organizer/${eventId}`);
  redirect(sessionUrl(eventId, outcome.id, "saved=session"));
}

const presets = {
  MORNING: { label: "เช้า", start: "08:30", end: "12:00" },
  AFTERNOON: { label: "บ่าย", start: "13:00", end: "16:30" },
  FULL_DAY: { label: "เต็มวัน", start: "08:30", end: "16:30" },
} as const;

/** Adds a preset session to every event day that does not already have a session with that label. */
export async function addPresetSessions(eventId: string, preset: keyof typeof presets) {
  const { membership, user } = await requireEventAccess(eventId, "manage");
  const template = presets[preset];
  if (!template) redirect(sessionUrl(eventId, undefined, "error=invalid-session"));
  const added = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
    const days = await tx.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true, date: true } });
    let count = 0;
    for (const day of days) {
      if (await sessionLabelTaken(tx, eventId, day.id, template.label)) continue;
      const session = await tx.session.create({ data: { eventId, eventDayId: day.id, label: template.label, startTime: sessionTime(day.date, template.start), endTime: sessionTime(day.date, template.end), sortOrder: await nextSortOrder(tx, eventId) }, select: { id: true } });
      if (requiresAdminAudit(membership)) await auditAdminChange(tx, eventId, user.id, "EVENT_SESSION_ADDED_BY_ADMIN", session.id);
      count++;
    }
    return count;
  });
  revalidatePath(`/organizer/${eventId}`);
  redirect(sessionUrl(eventId, undefined, added ? `saved=session&added=${added}` : "error=preset-exists"));
}

/** Copies one day's sessions (label and clock times) to every other day, skipping labels a day already has. */
export async function copyDaySessions(eventId: string, sourceDayId: string) {
  const { membership, user } = await requireEventAccess(eventId, "manage");
  const added = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
    const days = await tx.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true, date: true } });
    const source = await tx.session.findMany({ where: { eventId, eventDayId: sourceDayId }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
    let count = 0;
    for (const day of days) {
      if (day.id === sourceDayId) continue;
      for (const session of source) {
        if (await sessionLabelTaken(tx, eventId, day.id, session.label)) continue;
        const created = await tx.session.create({ data: { eventId, eventDayId: day.id, label: session.label, startTime: sessionTime(day.date, clockOf(session.startTime)), endTime: sessionTime(day.date, clockOf(session.endTime)), sortOrder: await nextSortOrder(tx, eventId) }, select: { id: true } });
        if (requiresAdminAudit(membership)) await auditAdminChange(tx, eventId, user.id, "EVENT_SESSION_ADDED_BY_ADMIN", created.id);
        count++;
      }
    }
    return count;
  });
  revalidatePath(`/organizer/${eventId}`);
  redirect(sessionUrl(eventId, undefined, added ? `saved=session&added=${added}` : "error=preset-exists"));
}
