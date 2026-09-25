"use server";

import { compare, hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireActiveUser } from "@/server/authorization/session";
import { db } from "@/server/db";

const schema = z.object({
  current: z.string().min(1).max(200),
  password: z.string().min(12).max(128),
  confirm: z.string(),
}).refine((value) => value.password === value.confirm);

export async function changeOwnPassword(formData: FormData) {
  const user = await requireActiveUser();
  const parsed = schema.safeParse({ current: formData.get("current"), password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) redirect("/account/password?error=password");
  const account = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!account.passwordHash || !(await compare(parsed.data.current, account.passwordHash))) redirect("/account/password?error=current");
  const passwordHash = await hash(parsed.data.password, 12);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash } }),
    db.userToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    db.auditLog.create({ data: { actorId: user.id, action: "ACCOUNT_PASSWORD_CHANGED", target: user.id } }),
  ]);
  redirect("/account/password?changed=1");
}
