import type { OrganizerRole } from "@/features/events/domain";

export type SystemRole = "organizer" | "admin";

export type EventMembership = {
  systemRole: SystemRole;
  userId: string;
  ownerId: string;
  collaboratorRole: OrganizerRole | null;
};

export function canViewEvent(membership: EventMembership) {
  return (
    membership.systemRole === "admin" ||
    membership.userId === membership.ownerId ||
    membership.collaboratorRole === "full"
  );
}

export function canManageEvent(membership: EventMembership) {
  return (
    membership.systemRole === "admin" ||
    membership.userId === membership.ownerId ||
    membership.collaboratorRole === "full"
  );
}

export function canCheckIn(membership: EventMembership) {
  return (
    membership.systemRole === "admin" ||
    membership.userId === membership.ownerId ||
    membership.collaboratorRole !== null
  );
}

export function canAdministerEvent(membership: EventMembership) {
  return membership.userId === membership.ownerId || membership.systemRole === "admin";
}

export function requiresAdminAudit(membership: EventMembership) {
  return membership.systemRole === "admin" && membership.userId !== membership.ownerId;
}
