import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/server/db";

export async function requireActiveUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });

  if (!user?.isActive) redirect("/login");
  return user;
}

export async function requireAdminUser() {
  const user = await requireActiveUser();
  if (user.role !== "ADMIN") redirect("/organizer");
  return user;
}

export async function requireOrganizerUser() {
  const user = await requireActiveUser();
  if (user.role !== "STAFF") return user;

  const accessibleEvent = await db.event.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { ownerId: user.id },
        { organizers: { some: { userId: user.id, role: "FULL" } } },
      ],
    },
    select: { id: true },
  });

  if (!accessibleEvent) redirect("/check-in");
  return user;
}
