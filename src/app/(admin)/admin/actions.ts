"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hash } from "bcryptjs";

import { issueAccountToken } from "@/server/auth/account-tokens";
import { requireAdminUser } from "@/server/authorization/session";
import { db } from "@/server/db";

const userIdSchema = z.string().cuid();
const roleSchema = z.enum(["ORGANIZER", "STAFF", "ADMIN"]);

export async function createUser(formData: FormData) {
  const actor = await requireAdminUser();
  const parsed = z.object({
    name: z.string().trim().min(1).max(191),
    email: z.email().max(191),
    // Blank password = invitation: the new user sets their own password from a 7-day link.
    password: z.string().max(128).refine((value) => value === "" || value.length >= 12),
    role: roleSchema,
  }).safeParse({
    name: formData.get("name"),
    email: formData.get("email")?.toString().trim().toLowerCase(),
    password: formData.get("password") ?? "",
    role: formData.get("role"),
  });
  if (!parsed.success) redirect("/admin?error=invalid-user");

  let invite: { token: string } | null = null;
  try {
    invite = await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash: parsed.data.password ? await hash(parsed.data.password, 12) : null,
        role: parsed.data.role,
      }, select: { id: true } });
      await tx.auditLog.create({ data: {
        actorId: actor.id,
        action: "ADMIN_USER_CREATED",
        target: user.id,
        metadata: { email: parsed.data.email, role: parsed.data.role, invited: !parsed.data.password },
      } });
      return parsed.data.password ? null : issueAccountToken(tx, user.id, "INVITE", actor.id);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      redirect("/admin?error=email-exists");
    }
    throw error;
  }

  revalidatePath("/admin");
  if (invite) redirect(`/admin/account-link?token=${invite.token}`);
  redirect("/admin?created=1");
}

export async function issuePasswordLink(formData: FormData) {
  const actor = await requireAdminUser();
  const userId = userIdSchema.safeParse(formData.get("userId"));
  if (!userId.success) redirect("/admin?error=invalid-user-edit");
  const issued = await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId.data }, select: { id: true, isActive: true, passwordHash: true } });
    if (!target?.isActive) return null;
    // Accounts that never set a password get a fresh 7-day invitation; others get a 30-minute reset link.
    const kind = target.passwordHash ? "RESET" : "INVITE";
    const link = await issueAccountToken(tx, target.id, kind, actor.id);
    await tx.auditLog.create({ data: { actorId: actor.id, action: kind === "RESET" ? "ADMIN_PASSWORD_RESET_LINK_ISSUED" : "ADMIN_INVITE_LINK_ISSUED", target: target.id } });
    return link;
  });
  if (!issued) redirect("/admin?error=inactive-link");
  redirect(`/admin/account-link?token=${issued.token}`);
}

export async function updateUserDetails(formData: FormData) {
  const actor = await requireAdminUser();
  const parsed = z.object({
    userId: userIdSchema,
    name: z.string().trim().min(1).max(191),
    email: z.email().max(191),
    password: z.string().max(128).refine((value) => value === "" || value.length >= 12),
  }).safeParse({
    userId: formData.get("userId"),
    name: formData.get("name"),
    email: formData.get("email")?.toString().trim().toLowerCase(),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/admin?error=invalid-user-edit");

  try {
    await db.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, name: true, email: true } });
      if (!target) return;
      const passwordHash = parsed.data.password ? await hash(parsed.data.password, 12) : undefined;
      const changed = target.name !== parsed.data.name || target.email !== parsed.data.email || !!passwordHash;
      if (!changed) return;
      await tx.user.update({ where: { id: target.id }, data: { name: parsed.data.name, email: parsed.data.email, ...(passwordHash ? { passwordHash } : {}) } });
      await tx.auditLog.create({ data: {
        actorId: actor.id,
        action: "ADMIN_USER_DETAILS_UPDATED",
        target: target.id,
        metadata: { fromName: target.name, toName: parsed.data.name, fromEmail: target.email, toEmail: parsed.data.email, passwordReset: !!passwordHash },
      } });
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") redirect("/admin?error=email-exists");
    throw error;
  }
  revalidatePath("/admin");
  redirect("/admin?updated=1");
}

export async function updateUserRole(formData: FormData) {
  const actor = await requireAdminUser();
  const userId = userIdSchema.safeParse(formData.get("userId"));
  const role = roleSchema.safeParse(formData.get("role"));
  if (!userId.success || !role.success || userId.data === actor.id) return;

  await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId.data }, select: { id: true, role: true } });
    if (!target || target.role === role.data) return;
    if (target.role === "ADMIN" && role.data !== "ADMIN") {
      const activeAdmins = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
      const targetActive = await tx.user.findUnique({ where: { id: target.id }, select: { isActive: true } });
      if (targetActive?.isActive && activeAdmins <= 1) return;
    }
    await tx.user.update({ where: { id: target.id }, data: { role: role.data } });
    await tx.auditLog.create({ data: {
      actorId: actor.id,
      action: "ADMIN_USER_ROLE_UPDATED",
      target: target.id,
      metadata: { from: target.role, to: role.data },
    } });
  });
  revalidatePath("/admin");
}

export async function toggleUserActive(formData: FormData) {
  const actor = await requireAdminUser();
  const userId = userIdSchema.safeParse(formData.get("userId"));
  const active = z.enum(["true", "false"]).safeParse(formData.get("active"));
  if (!userId.success || !active.success || userId.data === actor.id) return;
  const isActive = active.data === "true";

  await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId.data }, select: { id: true, role: true, isActive: true } });
    if (!target || target.isActive === isActive) return;
    if (target.role === "ADMIN" && !isActive) {
      const activeAdmins = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
      if (activeAdmins <= 1) return;
    }
    await tx.user.update({ where: { id: target.id }, data: { isActive } });
    await tx.auditLog.create({ data: {
      actorId: actor.id,
      action: "ADMIN_USER_STATUS_UPDATED",
      target: target.id,
      metadata: { from: target.isActive, to: isActive },
    } });
  });
  revalidatePath("/admin");
}
