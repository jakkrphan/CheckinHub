"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { requiresAdminAudit } from "@/server/authorization/policy";
import { requireEventAccess } from "@/server/authorization/event";
import { requireActiveUser } from "@/server/authorization/session";
import { db } from "@/server/db";
import { coverImageUrl } from "@/features/events/cover-url";
import { copyLocalCover, deleteLocalCover, storeLocalCover } from "@/server/registrations/local-covers";
import { promoteWaitlist } from "@/server/registrations/lifecycle";
import { isFeatureEnabled, mayCreateEvents } from "@/server/settings/features";

const eventInput = z.object({
  title: z.string().trim().min(1).max(191),
  description: z.string().trim().max(10000),
  location: z.string().trim().max(191),
});

const eventSettingsInput = eventInput.extend({
  seatMode: z.enum(["per_day", "whole_course"]),
  maxSeats: z.preprocess((value) => value === "" || value == null ? null : value, z.coerce.number().int().min(1).max(1000000).nullable()),
  attendanceThreshold: z.preprocess((value) => value === "" || value == null ? null : value, z.coerce.number().int().min(1).max(100).nullable()),
  eventType: z.enum(["INTERNAL", "EXTERNAL", "MIXED"]),
  deadlineDate: z.union([z.literal(""), z.iso.date()]),
  autoApprove: z.boolean(),
  waitlistEnabled: z.boolean(),
  pendingHoldHours: z.preprocess((value) => value === "" || value == null ? null : value, z.coerce.number().int().min(1).max(720).nullable()),
  waitlistPromotion: z.enum(["MANUAL", "AUTO"]),
  retentionDays: z.preprocess((value) => value === "" || value == null ? 365 : value, z.coerce.number().int().min(30).max(3650)),
});

function parseEventForm(formData: FormData) {
  return eventSettingsInput.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    location: formData.get("location"),
    eventType: formData.get("eventType") ?? "INTERNAL",
    seatMode: formData.get("seatMode") ?? "per_day",
    maxSeats: formData.get("maxSeats"),
    attendanceThreshold: formData.get("attendanceThreshold"),
    deadlineDate: formData.get("deadlineDate") ?? "",
    autoApprove: formData.get("autoApprove") === "on",
    waitlistEnabled: formData.get("waitlistEnabled") === "on",
    pendingHoldHours: formData.get("pendingHoldHours"),
    waitlistPromotion: formData.get("waitlistPromotion") ?? "MANUAL",
    retentionDays: formData.get("retentionDays"),
  });
}

export async function createEvent(formData: FormData) {
  const user = await requireActiveUser();
  if (!(await mayCreateEvents(user.role))) redirect("/organizer?error=create-disabled");

  const parsed = parseEventForm(formData);
  if (!parsed.success) redirect("/organizer/new?error=invalid");

  const registrationDeadline = parsed.data.deadlineDate
    ? new Date(`${parsed.data.deadlineDate}T16:59:59.999Z`)
    : null;
  if (registrationDeadline && (
    Number.isNaN(registrationDeadline.valueOf()) ||
    registrationDeadline.toISOString().slice(0, 10) !== parsed.data.deadlineDate
  )) redirect("/organizer/new?error=invalid");

  const cover = await storeLocalCover(formData.get("coverImage"));
  if (!cover.ok) redirect("/organizer/new?error=invalid-cover");
  const slug = `event-${randomUUID()}`;

  let event: { id: string };
  try { event = await db.$transaction(async (tx) => {
    const created = await tx.event.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description || null,
      location: parsed.data.location || null,
      slug,
      ownerId: user.id,
      status: "DRAFT",
      eventType: parsed.data.eventType,
      registrationDeadline,
      autoApprove: parsed.data.autoApprove,
      waitlistEnabled: parsed.data.waitlistEnabled,
      seatMode: parsed.data.seatMode,
      maxSeats: parsed.data.seatMode === "whole_course" ? parsed.data.maxSeats : null,
      attendanceThreshold: parsed.data.seatMode === "whole_course" ? parsed.data.attendanceThreshold : null,
      pendingHoldHours: parsed.data.pendingHoldHours,
      retentionDays: parsed.data.retentionDays,
      waitlistPromotion: parsed.data.waitlistPromotion,
      coverImageKey: cover.key,
      coverImageUrl: cover.key ? coverImageUrl(slug, cover.key) : null,
      fields: [],
    },
    select: { id: true },
    });
    if (user.role === "ADMIN") await tx.auditLog.create({ data: { eventId: created.id, actorId: user.id, action: "ADMIN_EVENT_CREATED", target: created.id } });
    return created;
  }); } catch (error) { await deleteLocalCover(cover.key); throw error; }

  revalidatePath("/organizer");
  redirect(`/organizer/${event.id}?step=2`);
}

export async function updateEvent(eventId: string, formData: FormData) {
  const { membership, user, event: originalEvent } = await requireEventAccess(eventId, "manage");
  const parsed = eventSettingsInput.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    location: formData.get("location"),
    eventType: formData.get("eventType"),
    seatMode: formData.get("seatMode") ?? originalEvent.seatMode,
    maxSeats: formData.get("maxSeats") ?? originalEvent.maxSeats?.toString() ?? "",
    attendanceThreshold: formData.get("attendanceThreshold") ?? originalEvent.attendanceThreshold?.toString() ?? "",
    deadlineDate: formData.get("deadlineDate"),
    autoApprove: formData.get("autoApprove") === "on",
    waitlistEnabled: formData.get("waitlistEnabled") === "on",
    pendingHoldHours: formData.get("pendingHoldHours") ?? originalEvent.pendingHoldHours?.toString() ?? "",
    waitlistPromotion: formData.get("waitlistPromotion") ?? originalEvent.waitlistPromotion,
    retentionDays: formData.get("retentionDays") ?? originalEvent.retentionDays.toString(),
  });
  if (!parsed.success) redirect(`/organizer/${eventId}?error=invalid`);
  if (originalEvent.status !== "DRAFT" && parsed.data.seatMode !== originalEvent.seatMode) redirect(`/organizer/${eventId}?error=invalid`);

  const registrationDeadline = parsed.data.deadlineDate
    ? new Date(`${parsed.data.deadlineDate}T16:59:59.999Z`)
    : null;
  if (registrationDeadline && (
    Number.isNaN(registrationDeadline.valueOf()) ||
    registrationDeadline.toISOString().slice(0, 10) !== parsed.data.deadlineDate
  )) redirect(`/organizer/${eventId}?error=invalid`);

  const uploadedCover = await storeLocalCover(formData.get("coverImage"));
  if (!uploadedCover.ok) redirect(`/organizer/${eventId}?step=1&error=invalid-cover`);
  const removeCover = formData.get("removeCover") === "on";

  try { await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
    const lockedEvent = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true, seatMode: true } });
    if (lockedEvent.status !== "DRAFT" && parsed.data.seatMode !== lockedEvent.seatMode) throw new Error("seat-mode-locked");
    if (parsed.data.seatMode !== lockedEvent.seatMode && await tx.registrant.count({ where: { eventId } })) throw new Error("seat-mode-in-use");
    if (parsed.data.seatMode === "whole_course" && parsed.data.maxSeats !== null) {
      const occupied = await tx.registrant.count({ where: { eventId, status: { in: ["PENDING", "APPROVED"] } } });
      if (parsed.data.maxSeats < occupied) throw new Error("seats-in-use");
    }
    await tx.event.update({
      where: { id: eventId },
      data: {
        title: parsed.data.title,
        description: parsed.data.description || null,
        location: parsed.data.location || null,
        eventType: parsed.data.eventType,
        registrationDeadline,
        autoApprove: parsed.data.autoApprove,
        waitlistEnabled: parsed.data.waitlistEnabled,
        seatMode: parsed.data.seatMode,
        maxSeats: parsed.data.seatMode === "whole_course" ? parsed.data.maxSeats : null,
        attendanceThreshold: parsed.data.seatMode === "whole_course" ? parsed.data.attendanceThreshold : null,
        pendingHoldHours: parsed.data.pendingHoldHours,
        retentionDays: parsed.data.retentionDays,
        waitlistPromotion: parsed.data.waitlistPromotion,
        ...(uploadedCover.key ? { coverImageKey: uploadedCover.key, coverImageUrl: coverImageUrl(originalEvent.slug, uploadedCover.key) } : {}),
        ...(removeCover ? { coverImageKey: null, coverImageUrl: null } : {}),
      },
    });
    if (parsed.data.seatMode === "whole_course" && (originalEvent.maxSeats === null ? false : parsed.data.maxSeats === null || parsed.data.maxSeats > originalEvent.maxSeats)) await promoteWaitlist(tx, eventId);

    if (requiresAdminAudit(membership)) {
      await tx.auditLog.create({
        data: {
          eventId,
          actorId: user.id,
          action: "EVENT_UPDATED_BY_ADMIN",
          target: eventId,
          metadata: { fields: ["title", "description", "location", "eventType", "registrationDeadline", "autoApprove", "waitlistEnabled", ...(uploadedCover.key || removeCover ? ["coverImage"] : [])] },
        },
      });
    }
  }); } catch (error) { await deleteLocalCover(uploadedCover.key); if (error instanceof Error && ["seat-mode-locked", "seat-mode-in-use", "seats-in-use"].includes(error.message)) redirect(`/organizer/${eventId}?error=invalid`); throw error; }
  if (uploadedCover.key || removeCover) {
    await deleteLocalCover(originalEvent.coverImageKey);
    if (removeCover) await deleteLocalCover(uploadedCover.key);
  }

  revalidatePath("/organizer");
  revalidatePath(`/organizer/${eventId}`);
  // The wizard footer saves step 1 and moves on; the in-page save stays on step 1.
  redirect(formData.get("next") === "2" ? `/organizer/${eventId}?step=2` : `/organizer/${eventId}?step=1&saved=1`);
}

/**
 * Clones a project into a new draft (spec 1.2): copies settings, form fields, cover (as a new file) and sessions.
 * Days, seats, deadline, registrants, check-ins and collaborators are not copied; sessions come across unbound
 * because the new days do not exist yet, keeping the first session of each label.
 */
export async function cloneEvent(eventId: string) {
  const { user, event, membership } = await requireEventAccess(eventId, "manage");
  if (!(await mayCreateEvents(user.role)) || !(await isFeatureEnabled("eventClone"))) redirect("/organizer?error=create-disabled");
  const sessions = await db.session.findMany({ where: { eventId }, orderBy: [{ eventDay: { date: "asc" } }, { sortOrder: "asc" }, { label: "asc" }] });
  const uniqueSessions = sessions.filter((session, index) => sessions.findIndex((other) => other.label === session.label) === index);
  const coverKey = await copyLocalCover(event.coverImageKey);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
  const unboundTime = (value: Date | null) => value ? new Date(`1970-01-01T${clock.format(value)}:00+07:00`) : null;
  const slug = `event-${randomUUID()}`;
  const cloned = await db.$transaction(async (tx) => {
    const copy = await tx.event.create({ data: {
      title: `${event.title} (สำเนา)`, slug, ownerId: user.id, clonedFromId: event.id,
      description: event.description, location: event.location, eventType: event.eventType,
      autoApprove: event.autoApprove, waitlistEnabled: event.waitlistEnabled, fields: event.fields as Prisma.InputJsonValue, fieldsVersion: 1,
      seatMode: event.seatMode, maxSeats: event.maxSeats, attendanceThreshold: event.attendanceThreshold,
      pendingHoldHours: event.pendingHoldHours, waitlistPromotion: event.waitlistPromotion, retentionDays: event.retentionDays,
      coverImageKey: coverKey, coverImageUrl: coverKey ? coverImageUrl(slug, coverKey) : null,
      status: "DRAFT", registrationDeadline: null,
    } });
    for (const [index, session] of uniqueSessions.entries()) {
      await tx.session.create({ data: { eventId: copy.id, eventDayId: null, label: session.label, startTime: unboundTime(session.startTime), endTime: unboundTime(session.endTime), sortOrder: index + 1 } });
    }
    if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "EVENT_CLONED_BY_ADMIN", target: copy.id, metadata: { sourceEventId: eventId } } });
    return copy;
  }).catch(async (error) => { await deleteLocalCover(coverKey); throw error; });
  revalidatePath("/organizer");
  redirect(`/organizer/${cloned.id}?step=1&saved=cloned`);
}
