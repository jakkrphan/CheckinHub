"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireEventAccess } from "@/server/authorization/event";
import { requiresAdminAudit } from "@/server/authorization/policy";
import { db } from "@/server/db";
import { getSeatAvailability, seatsTaken, syncRegistrantStatus } from "@/server/registrations/day-status";
import { lockEventDays, promoteWaitlist } from "@/server/registrations/lifecycle";
import { hashBearerCode, newBearerCode } from "@/server/registrations/registration";

/** Returns to the list view the organizer acted from (filters + selected person), adding the result flags. */
function backTo(eventId: string, formData: FormData | undefined, flags: Record<string, string | number | undefined>) {
  const base = `/organizer/${eventId}/registrants`;
  const raw = formData?.get("returnTo");
  const url = new URL(typeof raw === "string" && (raw === base || raw.startsWith(`${base}?`)) ? raw : base, "http://local");
  for (const key of ["result", "approved", "requested"]) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(flags)) if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  return `${url.pathname}${url.search}`;
}

export async function decideRegistrant(eventId: string, registrantId: string, decision: "approve" | "reject" | "cancel", formData?: FormData) {
  const { user, membership } = await requireEventAccess(eventId, "manage");
  const rawReason = decision === "reject" ? formData?.get("reason") : null;
  const rejectReason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim().slice(0, 500) : null;
  let result = "updated";
  let approvedDays = 0;
  let requestedDays = 0;
  try {
    await db.$transaction(async (tx) => {
      await lockEventDays(tx, eventId);
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { id: true, seatMode: true, maxSeats: true } });
      const registrant = await tx.registrant.findFirst({
        where: { id: registrantId, eventId },
        include: { days: { select: { id: true, eventDayId: true, status: true, eventDay: { select: { maxSeats: true } } } } },
      });
      if (!registrant) { result = "missing"; return; }
      if (event.seatMode === "whole_course") {
        if (decision === "approve") {
          if (registrant.status !== "PENDING" && registrant.status !== "WAITLISTED") { result = "invalid"; return; }
          const availability = await getSeatAvailability(tx, event, []);
          if (registrant.status === "WAITLISTED" && availability.mode === "whole_course" && availability.remaining === 0) { result = "full"; return; }
          requestedDays = registrant.days.length;
          approvedDays = requestedDays;
          await tx.registrantEventDay.updateMany({ where: { registrantId }, data: { status: "APPROVED", waitlistedAt: null, pendingSince: null } });
          await tx.registrant.update({ where: { id: registrantId }, data: { approvedById: user.id } });
        } else {
          const status = decision === "reject" ? "REJECTED" : "CANCELLED";
          if (decision === "reject" && registrant.status !== "PENDING" && registrant.status !== "WAITLISTED") { result = "invalid"; return; }
          if (decision === "cancel" && registrant.status !== "APPROVED") { result = "invalid"; return; }
          if (decision === "cancel" && await tx.checkIn.count({ where: { registrantId, voidedAt: null } })) { result = "invalid"; return; }
          await tx.registrantEventDay.updateMany({ where: { registrantId }, data: { status, waitlistedAt: null, pendingSince: null } });
          if (decision === "reject") await tx.registrant.update({ where: { id: registrantId }, data: { rejectReason } });
        }
        await syncRegistrantStatus(tx, registrantId);
        if (decision !== "approve") await promoteWaitlist(tx, eventId);
        if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "REGISTRANT_UPDATED_BY_ADMIN", target: registrantId, metadata: { decision } } });
        return;
      }
      if (decision === "approve") {
        for (const day of registrant.days) {
          if (day.status !== "PENDING" && day.status !== "WAITLISTED") continue;
          requestedDays++;
          if (day.status === "PENDING" || (day.status === "WAITLISTED" && (day.eventDay.maxSeats === null || (await seatsTaken(tx, day.eventDayId)) < day.eventDay.maxSeats))) {
            await tx.registrantEventDay.update({ where: { id: day.id }, data: { status: "APPROVED", waitlistedAt: null, pendingSince: null } });
            approvedDays++;
          }
        }
        if (!approvedDays) { result = requestedDays ? "full" : "invalid"; return; }
        await tx.registrant.update({ where: { id: registrantId }, data: { approvedById: user.id } });
      } else if (decision === "reject") {
        const updated = await tx.registrantEventDay.updateMany({ where: { registrantId, status: { in: ["PENDING", "WAITLISTED"] } }, data: { status: "REJECTED", waitlistedAt: null, pendingSince: null } });
        if (!updated.count) { result = "invalid"; return; }
        await tx.registrant.update({ where: { id: registrantId }, data: { rejectReason } });
      } else {
        const updated = await tx.registrantEventDay.updateMany({ where: { registrantId, status: "APPROVED" }, data: { status: "CANCELLED", pendingSince: null } });
        if (!updated.count) { result = "invalid"; return; }
      }
      await syncRegistrantStatus(tx, registrantId);
      if (decision === "approve" && approvedDays < requestedDays) result = "partial";
      if (decision !== "approve") await promoteWaitlist(tx, eventId);
      if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "REGISTRANT_UPDATED_BY_ADMIN", target: registrantId, metadata: { decision } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") result = "retry";
    else throw error;
  }
  revalidatePath(`/organizer/${eventId}/registrants`);
  redirect(backTo(eventId, formData, { result, approved: requestedDays ? approvedDays : undefined, requested: requestedDays || undefined }));
}

export async function approveSelected(eventId: string, formData: FormData) {
  const { user, membership } = await requireEventAccess(eventId, "manage");
  const ids = formData.getAll("registrantId").filter((value): value is string => typeof value === "string" && !!value);
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) redirect(backTo(eventId, formData, { result: "invalid" }));
  const outcome = await db.$transaction(async (tx) => {
    await lockEventDays(tx, eventId);
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { id: true, seatMode: true, maxSeats: true } });
    const people = await tx.registrant.findMany({ where: { eventId, id: { in: ids }, status: "PENDING" }, select: { id: true } });
    if (people.length !== ids.length) return null;
    let approvedDays = 0;
    let requestedDays = 0;
    for (const person of people) {
      const days = await tx.registrantEventDay.findMany({ where: { registrantId: person.id, status: { in: ["PENDING", "WAITLISTED"] } }, select: { id: true, eventDayId: true, status: true, eventDay: { select: { maxSeats: true } } } });
      if (event.seatMode === "whole_course") {
        const availability = await getSeatAvailability(tx, event, []);
        requestedDays += days.length;
        if (availability.mode === "whole_course" && availability.remaining === 0 && days.some((day) => day.status === "WAITLISTED")) continue;
        await tx.registrantEventDay.updateMany({ where: { registrantId: person.id }, data: { status: "APPROVED", waitlistedAt: null, pendingSince: null } });
        approvedDays += days.length;
        await tx.registrant.update({ where: { id: person.id }, data: { approvedById: user.id } });
        await syncRegistrantStatus(tx, person.id);
        continue;
      }
      for (const day of days) {
        requestedDays++;
        if (day.status === "WAITLISTED" && day.eventDay.maxSeats !== null && (await seatsTaken(tx, day.eventDayId)) >= day.eventDay.maxSeats) continue;
        await tx.registrantEventDay.update({ where: { id: day.id }, data: { status: "APPROVED", waitlistedAt: null, pendingSince: null } });
        approvedDays++;
      }
      await tx.registrant.update({ where: { id: person.id }, data: { approvedById: user.id } });
      await syncRegistrantStatus(tx, person.id);
    }
    if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "REGISTRANTS_APPROVED_BY_ADMIN", target: ids.join(",") } });
    return { approvedDays, requestedDays };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  revalidatePath(`/organizer/${eventId}/registrants`);
  redirect(backTo(eventId, formData, { result: !outcome ? "invalid" : outcome.approvedDays < outcome.requestedDays ? "partial" : "updated", approved: outcome?.approvedDays, requested: outcome?.requestedDays }));
}

export async function decideRegistrantDay(eventId: string, registrantId: string, eventDayId: string, decision: "approve" | "reject" | "cancel", formData?: FormData) {
  const { user, membership } = await requireEventAccess(eventId, "manage");
  const event = await db.event.findUniqueOrThrow({ where: { id: eventId }, select: { seatMode: true } });
  if (event.seatMode === "whole_course") redirect(backTo(eventId, formData, { result: "invalid" }));
  let result = "updated";
  await db.$transaction(async (tx) => {
    await lockEventDays(tx, eventId);
    const row = await tx.registrantEventDay.findFirst({
      where: { registrantId, eventDayId, registrant: { eventId } },
      select: { id: true, status: true, eventDay: { select: { maxSeats: true } } },
    });
    if (!row) { result = "missing"; return; }
    if (decision === "approve") {
      if (row.status !== "PENDING" && row.status !== "WAITLISTED") { result = "invalid"; return; }
      if (row.status === "WAITLISTED" && row.eventDay.maxSeats !== null && (await seatsTaken(tx, eventDayId)) >= row.eventDay.maxSeats) { result = "full"; return; }
      await tx.registrantEventDay.update({ where: { id: row.id }, data: { status: "APPROVED", waitlistedAt: null, pendingSince: null } });
      await tx.registrant.update({ where: { id: registrantId }, data: { approvedById: user.id } });
    } else if (decision === "reject") {
      if (row.status !== "PENDING" && row.status !== "WAITLISTED") { result = "invalid"; return; }
      await tx.registrantEventDay.update({ where: { id: row.id }, data: { status: "REJECTED", waitlistedAt: null, pendingSince: null } });
    } else {
      if (row.status !== "APPROVED") { result = "invalid"; return; }
      await tx.registrantEventDay.update({ where: { id: row.id }, data: { status: "CANCELLED", pendingSince: null } });
    }
    await syncRegistrantStatus(tx, registrantId);
    if (decision !== "approve") await promoteWaitlist(tx, eventId);
    if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "REGISTRANT_DAY_UPDATED_BY_ADMIN", target: row.id, metadata: { decision } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  revalidatePath(`/organizer/${eventId}/registrants`);
  redirect(backTo(eventId, formData, { result }));
}

export async function reissueStatusLink(eventId: string, registrantId: string, formData: FormData) {
  const { event, user } = await requireEventAccess(eventId, "manage");
  if (formData.get("confirm") !== "on") redirect(backTo(eventId, formData, { result: "confirm" }));
  const token = newBearerCode();
  const person = await db.$transaction(async (tx) => {
    const current = await tx.registrant.findFirst({ where: { id: registrantId, eventId }, select: { id: true } });
    if (!current) return null;
    await tx.registrant.update({ where: { id: registrantId }, data: { statusTokenHash: hashBearerCode(token) } });
    await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "STATUS_LINK_REISSUED", target: registrantId } });
    return current;
  });
  if (!person) redirect(backTo(eventId, formData, { result: "missing" }));
  redirect(`/events/${event.slug}/status/${token}`);
}
