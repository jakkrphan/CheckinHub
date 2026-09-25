import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";

import { auth } from "@/auth";
import { safeReturnTo } from "@/server/auth/return-to";
import { db } from "@/server/db";

async function loginRedirect(reason?: string): Promise<never> {
  const next = safeReturnTo((await headers()).get("x-return-to"));
  const params = new URLSearchParams();
  if (next) params.set("next", next);
  if (reason) params.set("error", reason);
  redirect(`/login${params.size ? `?${params}` : ""}`);
}

export async function requireActiveUser() {
  const session = await auth();
  if (!session?.user?.id) return loginRedirect();

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });

  if (!user?.isActive) return loginRedirect("inactive");
  return user;
}

export async function requireAdminUser() {
  const user = await requireActiveUser();
  if (user.role !== "ADMIN") forbidden();
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
