"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { readRegistrationFields, validateRegistrationFields } from "@/features/events/registration-fields";
import { requireEventAccess } from "@/server/authorization/event";
import { requiresAdminAudit } from "@/server/authorization/policy";
import { db } from "@/server/db";
import { captchaReadyToPublish } from "@/server/settings/features";

export async function changeEventStatus(eventId: string, target: "PUBLISHED" | "CLOSED") {
  // Publishing and closing are owner-only (admins included), per the access-control spec.
  const { event, membership, user } = await requireEventAccess(eventId, "administer");
  if (target === "PUBLISHED") {
    const [days, globalSessionCount] = await Promise.all([
      db.eventDay.findMany({ where: { eventId }, include: { sessions: { select: { id: true } } } }),
      db.session.count({ where: { eventId, eventDayId: null } }),
    ]);
    const fields = readRegistrationFields(event.fields);
    const ready = event.registrationDeadline && event.registrationDeadline > new Date()
      && days.length > 0 && days.every((day) => globalSessionCount > 0 || day.sessions.length > 0)
      && fields.length > 0 && validateRegistrationFields(fields)
      && fields.every((field) => field.type !== "file" || process.env.NODE_ENV !== "production")
      && await captchaReadyToPublish();
    if (!ready || event.status === "PUBLISHED") redirect(`/organizer/${eventId}?error=not-ready`);
  } else if (event.status !== "PUBLISHED") {
    redirect(`/organizer/${eventId}?error=invalid-status`);
  }
  await db.$transaction(async (tx) => {
    await tx.event.update({ where: { id: eventId }, data: { status: target } });
    if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "EVENT_STATUS_CHANGED_BY_ADMIN", target: target, metadata: { previousStatus: event.status } } });
  });
  revalidatePath(`/organizer/${eventId}`);
  revalidatePath(`/events/${event.slug}`);
  revalidatePath("/organizer");
  redirect(`/organizer/${eventId}?saved=status`);
}
