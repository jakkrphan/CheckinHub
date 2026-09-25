import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { hashAccountToken } from "@/server/auth/account-tokens";
import { db } from "@/server/db";

import { setAccountPassword } from "./actions";

export const metadata: Metadata = { title: "ตั้งรหัสผ่าน", referrer: "no-referrer" };

export default async function AccountSetupPage({ params, searchParams }: PageProps<"/account/setup/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;
  const record = await db.userToken.findUnique({
    where: { tokenHash: hashAccountToken(token) },
    select: { kind: true, usedAt: true, expiresAt: true, user: { select: { name: true, email: true, isActive: true } } },
  });
  const usable = !!record && !record.usedAt && record.expiresAt > new Date() && record.user.isActive;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-8 px-5 py-12">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-primary">เช็คอินอบรม</p>
        <h1 className="font-heading text-3xl font-bold tracking-tight">{record?.kind === "RESET" ? "ตั้งรหัสผ่านใหม่" : "ตั้งรหัสผ่านครั้งแรก"}</h1>
        {usable && <p className="text-muted-foreground">บัญชี {record.user.name} ({record.user.email})</p>}
      </div>
      {usable ? (
        <form action={setAccountPassword.bind(null, token)} className="flex flex-col gap-6 rounded-xl border bg-card p-6 shadow-sm">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="password">รหัสผ่านใหม่</FieldLabel>
              <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
              <FieldDescription>อย่างน้อย 12 ตัวอักษร</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm">ยืนยันรหัสผ่านใหม่</FieldLabel>
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
            </Field>
          </FieldGroup>
          {error === "password" && <p role="alert" className="text-sm text-destructive">รหัสผ่านต้องยาวอย่างน้อย 12 ตัวและตรงกันทั้งสองช่อง</p>}
          {error === "invalid" && <p role="alert" className="text-sm text-destructive">ลิงก์นี้ใช้ไม่ได้แล้ว กรุณาขอลิงก์ใหม่จากผู้ดูแลระบบ</p>}
          <Button type="submit" size="lg">บันทึกรหัสผ่าน</Button>
        </form>
      ) : (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border bg-card p-6">
          <p className="font-medium">ลิงก์นี้หมดอายุ ถูกใช้ไปแล้ว หรือไม่ถูกต้อง</p>
          <p className="text-sm text-muted-foreground">ลิงก์เชิญมีอายุ 7 วัน และลิงก์รีเซ็ตรหัสผ่านมีอายุ 30 นาที ใช้ได้ครั้งเดียว กรุณาติดต่อผู้ดูแลระบบเพื่อขอลิงก์ใหม่</p>
          <Link href="/login" className="text-sm underline underline-offset-4">ไปหน้าเข้าสู่ระบบ</Link>
        </div>
      )}
    </main>
  );
}
