"use server";

import { Prisma, type RegistrantStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { parseRegistrationAnswers, readRegistrationFields } from "@/features/events/registration-fields";
import { CURRENT_CONSENT_VERSION } from "@/features/registrations/consent";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";
import { getSeatAvailability, summarizeDayStatuses } from "@/server/registrations/day-status";
import { hashBearerCode, newBearerCode } from "@/server/registrations/registration";
import { deleteLocalRegistrationFiles, storeLocalRegistrationFiles } from "@/server/registrations/local-files";

const errorUrl = (eventId: string, reason: string) => `/organizer/${eventId}/registrants/new?error=${reason}`;

export async function addManualRegistrant(eventId: string, formData: FormData) {
  const { event, user } = await requireEventAccess(eventId, "manage");
  if (event.status === "DRAFT") redirect(errorUrl(eventId, "not-open"));
  if (formData.get("consent") !== "on") redirect(errorUrl(eventId, "consent"));

  // Walk-ins may have no email (the organizer prints the QR); then there is no dedupe key, as the spec allows.
  const rawEmail = formData.get("email")?.toString().trim().toLowerCase() ?? "";
  const parsedEmail = z.union([z.literal(""), z.email().max(191)]).safeParse(rawEmail);
  const requestedDays = formData.getAll("dayId");
  if (!parsedEmail.success || (event.seatMode !== "whole_course" && !requestedDays.length) || requestedDays.length > 60 || requestedDays.some((id) => typeof id !== "string" || !id)) {
    redirect(errorUrl(eventId, "invalid"));
  }
  const email = parsedEmail.data || null;
  const dayIds = [...new Set(requestedDays as string[])].sort();
  if (dayIds.length !== requestedDays.length) redirect(errorUrl(eventId, "invalid"));
  const fields = readRegistrationFields(event.fields);
  const stored = await storeLocalRegistrationFiles(fields, formData);
  if (!stored.ok) redirect(errorUrl(eventId, "invalid"));
  const answers = parseRegistrationAnswers(fields, formData, stored.uploads);
  if (!answers) {
    await deleteLocalRegistrationFiles(stored.keys);
    redirect(errorUrl(eventId, "invalid"));
  }

  const approved = formData.get("approveNow") === "on";
  // Over-capacity approval is an explicit, audited exception for walk-ins that must be admitted.
  const overrideCapacity = approved && formData.get("overrideCapacity") === "on";
  let overriddenDays = 0;
  let token: string | null = null;
  let failure: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
        const currentEvent = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { id: true, status: true, seatMode: true, maxSeats: true, fieldsVersion: true } });
        if (currentEvent.status === "DRAFT") { failure = "not-open"; return; }
        const days = await tx.eventDay.findMany({ where: { eventId, ...(currentEvent.seatMode === "whole_course" ? {} : { id: { in: dayIds } }) }, select: { id: true, maxSeats: true, isClosed: true }, orderBy: { id: "asc" } });
        if (!days.length || (currentEvent.seatMode === "whole_course" ? dayIds.length > 0 && (dayIds.length !== days.length || days.some((day) => !dayIds.includes(day.id))) : days.length !== dayIds.length)) { failure = "invalid"; return; }
        if (currentEvent.seatMode !== "whole_course") {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM EventDay WHERE eventId = ${eventId} AND id IN (${Prisma.join(dayIds)}) ORDER BY id FOR UPDATE`);
          if (days.some((day) => day.isClosed)) { failure = "not-open"; return; }
        }
        const existing = email ? await tx.registrant.findUnique({ where: { eventId_dedupeKey: { eventId, dedupeKey: email } }, select: { id: true } }) : null;
        if (existing) { failure = "duplicate"; return; }
        const availability = await getSeatAvailability(tx, currentEvent, days.map((day) => day.id));
        overriddenDays = 0;
        const courseFull = availability.mode === "whole_course" && availability.remaining === 0;
        if (courseFull && overrideCapacity) overriddenDays = days.length;
        const wholeStatus: RegistrantStatus | null = availability.mode === "whole_course" ? courseFull && !overrideCapacity ? "WAITLISTED" : approved ? "APPROVED" : "PENDING" : null;
        const dayStatuses: { eventDayId: string; status: RegistrantStatus; waitlistedAt: Date | null; pendingSince: Date | null }[] = [];
        for (const day of days) {
          const dayFull = availability.mode === "per_day" && availability.days.get(day.id)?.remaining === 0;
          if (dayFull && overrideCapacity) overriddenDays++;
          const status: RegistrantStatus = wholeStatus ?? (dayFull && !overrideCapacity ? "WAITLISTED" : approved ? "APPROVED" : "PENDING");
          dayStatuses.push({ eventDayId: day.id, status, waitlistedAt: status === "WAITLISTED" ? new Date() : null, pendingSince: status === "PENDING" ? new Date() : null });
        }
        const status = summarizeDayStatuses(dayStatuses.map((day) => day.status));
        token = newBearerCode();
        const person = await tx.registrant.create({ data: {
          eventId, email, dedupeKey: email, answers, fieldsVersion: currentEvent.fieldsVersion, status,
          autoApproveAtRegistration: approved, notifyVia: "EMAIL", consentedAt: new Date(), consentVersion: CURRENT_CONSENT_VERSION,
          approvedAt: status === "APPROVED" ? new Date() : null,
          approvedById: status === "APPROVED" ? user.id : null,
          qrCode: status === "APPROVED" ? newBearerCode() : null,
          statusTokenHash: hashBearerCode(token),
          days: { create: dayStatuses },
        } });
        await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "MANUAL_REGISTRATION_CREATED", target: person.id, metadata: { consentConfirmedByOrganizer: true, requestedApproval: approved, initialStatus: status, capacityOverride: overriddenDays > 0, overriddenDays } } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      break;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { failure = "duplicate"; break; }
      if (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "1213"))) {
        if (attempt === 4) { failure = "retry"; break; }
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        continue;
      }
      await deleteLocalRegistrationFiles(stored.keys);
      throw error;
    }
  }
  if (failure || !token) {
    await deleteLocalRegistrationFiles(stored.keys);
    redirect(errorUrl(eventId, failure ?? "retry"));
  }
  revalidatePath(`/organizer/${eventId}/registrants`);
  redirect(`/events/${event.slug}/status/${token}`);
}
