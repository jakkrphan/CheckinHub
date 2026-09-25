"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireEventAccess } from "@/server/authorization/event";
import { requiresAdminAudit } from "@/server/authorization/policy";
import { db } from "@/server/db";

export async function addEventMember(eventId: string, formData: FormData) {
  const { event, membership, user: actor } = await requireEventAccess(eventId, "administer");
  const parsed = z.object({ email: z.email(), role: z.enum(["FULL", "CHECKIN_ONLY"]) }).safeParse({
    email: formData.get("email")?.toString().trim().toLowerCase(), role: formData.get("role"),
  });
  if (!parsed.success) redirect(`/organizer/${eventId}?error=invalid-member`);
  const user = await db.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, isActive: true } });
  if (!user?.isActive || user.id === event.ownerId) redirect(`/organizer/${eventId}?error=member-not-found`);
  await db.$transaction(async (tx) => {
    await tx.eventOrganizer.upsert({
      where: { eventId_userId: { eventId, userId: user.id } },
      create: { eventId, userId: user.id, role: parsed.data.role },
      update: { role: parsed.data.role },
    });
    if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: actor.id, action: "EVENT_MEMBER_UPDATED_BY_ADMIN", target: user.id, metadata: { role: parsed.data.role } } });
  });
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=member`);
}

export async function removeEventMember(eventId: string, userId: string) {
  const { membership, user: actor } = await requireEventAccess(eventId, "administer");
  await db.$transaction(async (tx) => {
    const result = await tx.eventOrganizer.deleteMany({ where: { eventId, userId } });
    if (result.count && requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: actor.id, action: "EVENT_MEMBER_REMOVED_BY_ADMIN", target: userId } });
  });
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=member`);
}
