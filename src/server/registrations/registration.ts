import { createHash, randomBytes } from "node:crypto";

import { type NotificationChannel, Prisma, type RegistrantStatus } from "@prisma/client";
import { z } from "zod";

import { checkRegistrationAnswers, parseRegistrationAnswers, readRegistrationFields, type AnswerProblem } from "@/features/events/registration-fields";
import { CURRENT_CONSENT_VERSION } from "@/features/registrations/consent";
import { registrantDisplayName } from "@/features/registrations/display-name";
import { db } from "@/server/db";
import { lineConfigured } from "@/server/line/client";
import { getSeatAvailability, summarizeDayStatuses } from "@/server/registrations/day-status";
import { checkFormTicket, HONEYPOT_FIELD } from "@/server/registrations/form-ticket";
import { deleteLocalRegistrationFiles, storeLocalRegistrationFiles } from "@/server/registrations/local-files";
import { issueQrCode } from "@/server/registrations/qr-code";
import { isFeatureEnabled } from "@/server/settings/features";

export const newBearerCode = () => randomBytes(32).toString("base64url");
export const hashBearerCode = (code: string) => createHash("sha256").update(code).digest("hex");

export type RegistrationFailure = "paused" | "form-changed" | "not-open" | "invalid" | "duplicate" | "rate-limited" | "captcha" | "unavailable" | "too-fast" | "expired" | "full";
export type RegistrationResult =
  | { ok: true; status: RegistrantStatus; token: string; qrCode: string | null; registrantId: string; notifyVia: NotificationChannel }
  | { ok: false; reason: RegistrationFailure; /** The answer that failed validation, when it is one field's fault. */ problem?: AnswerProblem };

async function verifyTurnstile(response: FormDataEntryValue | null, ip: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (typeof response !== "string" || !response) return false;

  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret, response, remoteip: ip }),
    cache: "no-store",
  });
  if (!result.ok) return false;
  const body = await result.json() as { success?: boolean };
  return body.success === true;
}

async function recordAttempt(ip: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  const ipHash = createHash("sha256").update(`${secret}:${ip}`).digest("hex");
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const attempts = await db.registrationAttempt.count({ where: { ipHash, createdAt: { gte: since } } });
  if (attempts >= 10) return false;
  await db.registrationAttempt.create({ data: { ipHash } });
  return true;
}

export async function registerForEvent(slug: string, formData: FormData, ip: string): Promise<RegistrationResult> {
  // Admin emergency switch; walk-in registration by organizers does not go through here.
  if (!(await isFeatureEnabled("publicRegistration"))) return { ok: false, reason: "paused" };
  if (!(await recordAttempt(ip))) return { ok: false, reason: "rate-limited" };
  // Bot signals: a filled honeypot or a form submitted within seconds of rendering.
  const honeypot = formData.get(HONEYPOT_FIELD);
  if (typeof honeypot === "string" && honeypot.trim()) return { ok: false, reason: "invalid" };
  const ticket = checkFormTicket(formData.get("formTicket"));
  if (ticket !== "ok") return { ok: false, reason: ticket === "invalid" ? "invalid" : ticket };
  // Admins may switch Turnstile off (e.g. a Cloudflare outage); the honeypot, form ticket and IP limit above still apply.
  if (await isFeatureEnabled("turnstile") && !(await verifyTurnstile(formData.get("cf-turnstile-response"), ip))) return { ok: false, reason: "captcha" };
  if (formData.get("consent") !== "on") return { ok: false, reason: "invalid" };

  // One channel: email, or LINE (only while it is offered; anything else means email). A LINE chooser gives no email —
  // their duplicate guard is set from the LINE account once it is connected (linkLineAccount).
  const notifyVia: NotificationChannel = formData.get("notifyVia") === "LINE" && lineConfigured() && await isFeatureEnabled("lineLogin") ? "LINE" : "EMAIL";
  const parsedEmail = z.email().max(191).safeParse(formData.get("email")?.toString().trim().toLowerCase());
  const email = notifyVia === "LINE" ? null : parsedEmail.success ? parsedEmail.data : undefined;
  const dayIds = formData.getAll("dayId");
  if (email === undefined || dayIds.length > 60 || dayIds.some((id) => typeof id !== "string" || !id)) {
    return { ok: false, reason: "invalid" };
  }
  const selectedIds = [...new Set(dayIds as string[])].sort();
  if (selectedIds.length !== dayIds.length) return { ok: false, reason: "invalid" };

  const eventForUpload = await db.event.findUnique({ where: { slug }, select: { status: true, deletedAt: true, registrationDeadline: true, fields: true, fieldsVersion: true } });
  if (!eventForUpload || eventForUpload.deletedAt || eventForUpload.status !== "PUBLISHED" || !eventForUpload.registrationDeadline || eventForUpload.registrationDeadline <= new Date()) return { ok: false, reason: "not-open" };
  const uploadFields = readRegistrationFields(eventForUpload.fields);
  // Checked before any file is stored, so a mistyped answer can be reported by field instead of a bare "invalid".
  // A form of file fields only leaves nothing to pre-check (and an empty field list would itself count as invalid).
  const typedFields = uploadFields.filter((field) => field.type !== "file");
  const typed = typedFields.length ? checkRegistrationAnswers(typedFields, formData) : { answers: {} };
  if ("problem" in typed) {
    // A page rendered from an older form version fails through no fault of the registrant: say the form changed.
    if (formData.get("fieldsVersion") !== String(eventForUpload.fieldsVersion)) return { ok: false, reason: "form-changed" };
    return { ok: false, reason: "invalid", ...(typed.problem.fieldKey ? { problem: typed.problem } : {}) };
  }
  const stored = await storeLocalRegistrationFiles(uploadFields, formData);
  if (!stored.ok) return { ok: false, reason: "invalid" };

  let fileAttachmentsCommitted = false;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await db.$transaction(async (tx) => {
        // Serialize publication/closure with registration, then lock selected day rows before counting seats.
        await tx.$queryRaw`SELECT id FROM Event WHERE slug = ${slug} FOR UPDATE`;
        const event = await tx.event.findUnique({
          where: { slug },
          select: { id: true, status: true, deletedAt: true, registrationDeadline: true, fields: true, fieldsVersion: true, autoApprove: true, seatMode: true, maxSeats: true },
        });
        if (!event || event.deletedAt || event.status !== "PUBLISHED" || !event.registrationDeadline || event.registrationDeadline <= new Date()) {
          return { ok: false, reason: "not-open" } as const;
        }

        const fields = readRegistrationFields(event.fields);
        const answers = parseRegistrationAnswers(fields, formData, stored.uploads);
        // A page rendered from an older form version fails validation through no fault of the registrant.
        if (!answers) return { ok: false, reason: formData.get("fieldsVersion") === String(event.fieldsVersion) ? "invalid" : "form-changed" } as const;

        const alreadyRegistered = email && await tx.registrant.findUnique({
          where: { eventId_dedupeKey: { eventId: event.id, dedupeKey: email } },
          select: { id: true },
        });
        if (alreadyRegistered) return { ok: false, reason: "duplicate" } as const;

        const selectedDays = event.seatMode === "whole_course"
          ? await tx.eventDay.findMany({ where: { eventId: event.id }, select: { id: true, maxSeats: true, isClosed: true }, orderBy: { id: "asc" } })
          : await tx.eventDay.findMany({ where: { eventId: event.id, id: { in: selectedIds } }, select: { id: true, maxSeats: true, isClosed: true }, orderBy: { id: "asc" } });
        if (!selectedDays.length || (event.seatMode === "whole_course" ? selectedIds.length > 0 && (selectedIds.length !== selectedDays.length || selectedDays.some((day) => !selectedIds.includes(day.id))) : selectedIds.length !== selectedDays.length)) return { ok: false, reason: "invalid" } as const;
        if (event.seatMode !== "whole_course") {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM EventDay WHERE eventId = ${event.id} AND id IN (${Prisma.join(selectedIds)}) ORDER BY id FOR UPDATE`);
          if (selectedDays.some((day) => day.isClosed)) return { ok: false, reason: "not-open" } as const;
        }
        const currentEvent = await tx.event.findUniqueOrThrow({ where: { id: event.id }, select: { status: true, registrationDeadline: true, autoApprove: true, waitlistEnabled: true } });
        if (currentEvent.status !== "PUBLISHED" || !currentEvent.registrationDeadline || currentEvent.registrationDeadline <= new Date()) return { ok: false, reason: "not-open" } as const;

        const availability = await getSeatAvailability(tx, event, selectedDays.map((day) => day.id));
        // Waitlist off: a full course or any full selected day refuses the registration instead of queueing it.
        const noSeat = availability.mode === "whole_course" ? availability.remaining === 0 : selectedDays.some((day) => availability.days.get(day.id)?.remaining === 0);
        if (noSeat && !currentEvent.waitlistEnabled) return { ok: false, reason: "full" } as const;
        const wholeStatus: RegistrantStatus | null = availability.mode === "whole_course"
          ? availability.remaining === 0 ? "WAITLISTED" : currentEvent.autoApprove ? "APPROVED" : "PENDING"
          : null;
        const dayStatuses: { eventDayId: string; status: RegistrantStatus; waitlistedAt: Date | null; pendingSince: Date | null }[] = [];
        for (const day of selectedDays) {
          const full = availability.mode === "per_day" && availability.days.get(day.id)?.remaining === 0;
          dayStatuses.push({
            eventDayId: day.id,
            status: wholeStatus ?? (full ? "WAITLISTED" : currentEvent.autoApprove ? "APPROVED" : "PENDING"),
            waitlistedAt: (wholeStatus ?? (full ? "WAITLISTED" : "PENDING")) === "WAITLISTED" ? new Date() : null,
            pendingSince: (wholeStatus ?? (full ? "WAITLISTED" : currentEvent.autoApprove ? "APPROVED" : "PENDING")) === "PENDING" ? new Date() : null,
          });
        }

        const status = summarizeDayStatuses(dayStatuses.map((day) => day.status));
        const token = newBearerCode();
        const qrCode = status === "APPROVED" ? await issueQrCode(tx) : null;
        const person = await tx.registrant.create({
          data: {
            eventId: event.id,
            email,
            dedupeKey: email,
            answers,
            displayName: registrantDisplayName(fields, answers),
            fieldsVersion: event.fieldsVersion,
            status,
            autoApproveAtRegistration: currentEvent.autoApprove,
            notifyVia,
            consentedAt: new Date(),
            consentVersion: CURRENT_CONSENT_VERSION,
            consentIp: ip.slice(0, 64),
            approvedAt: status === "APPROVED" ? new Date() : null,
            qrCode,
            statusTokenHash: hashBearerCode(token),
            days: { create: dayStatuses },
          },
        });
        const { queueEmailNotification } = await import("@/server/email/notifications");
        if (email) await queueEmailNotification(tx, person);
        return { ok: true, status, token, qrCode, registrantId: person.id, notifyVia } as const;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
        fileAttachmentsCommitted = result.ok;
        return result;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return { ok: false, reason: "duplicate" };
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "1213"))) {
          if (attempt === 4) return { ok: false, reason: "unavailable" };
          await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }
    return { ok: false, reason: "unavailable" };
  } finally {
    if (!fileAttachmentsCommitted) await deleteLocalRegistrationFiles(stored.keys);
  }
}
