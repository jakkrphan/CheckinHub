import { notFound } from "next/navigation";

import { canAdministerEvent, canCheckIn, canManageEvent, canViewEvent, type EventMembership } from "@/server/authorization/policy";
import { requireActiveUser } from "@/server/authorization/session";
import { db } from "@/server/db";

type EventPermission = "view" | "manage" | "administer" | "checkIn";

export async function requireEventAccess(eventId: string, permission: EventPermission) {
  const user = await requireActiveUser();
  const event = await db.event.findUnique({
    where: { id: eventId, deletedAt: null },
    include: {
      organizers: {
        where: { userId: user.id },
        select: { role: true },
      },
    },
  });

  if (!event) notFound();

  const membership: EventMembership = {
    systemRole: user.role === "ADMIN" ? "admin" : "organizer",
    userId: user.id,
    ownerId: event.ownerId,
    collaboratorRole: event.organizers[0]?.role === "FULL" ? "full" : event.organizers[0]?.role === "CHECKIN_ONLY" ? "checkin_only" : null,
  };

  const allowed = {
    view: canViewEvent,
    manage: canManageEvent,
    administer: canAdministerEvent,
    checkIn: canCheckIn,
  }[permission](membership);

  if (!allowed) notFound();

  return { event, user, membership };
}
