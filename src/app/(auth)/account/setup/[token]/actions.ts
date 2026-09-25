"use server";

import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";

import { hashAccountToken } from "@/server/auth/account-tokens";
import { db } from "@/server/db";

const passwordSchema = z.object({ password: z.string().min(12).max(128), confirm: z.string() }).refine((value) => value.password === value.confirm);

export async function setAccountPassword(token: string, formData: FormData) {
  const parsed = passwordSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) redirect(`/account/setup/${token}?error=password`);
  const passwordHash = await hash(parsed.data.password, 12);
  const outcome = await db.$transaction(async (tx) => {
    const record = await tx.userToken.findUnique({ where: { tokenHash: hashAccountToken(token) }, select: { id: true, kind: true, usedAt: true, expiresAt: true, userId: true, user: { select: { isActive: true } } } });
    if (!record || record.usedAt || record.expiresAt <= new Date() || !record.user.isActive) return "invalid" as const;
    // Conditional update makes the token single-use even if two submissions race.
    const claimed = await tx.userToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!claimed.count) return "invalid" as const;
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.userToken.deleteMany({ where: { userId: record.userId, usedAt: null } });
    await tx.auditLog.create({ data: { actorId: record.userId, action: record.kind === "INVITE" ? "ACCOUNT_INVITE_ACCEPTED" : "ACCOUNT_PASSWORD_RESET", target: record.userId } });
    return "ok" as const;
  });
  if (outcome !== "ok") redirect(`/account/setup/${token}?error=invalid`);
  redirect("/login?notice=password-set");
}
