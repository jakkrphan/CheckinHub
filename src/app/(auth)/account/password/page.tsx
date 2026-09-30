import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requireActiveUser } from "@/server/authorization/session";
import { db } from "@/server/db";

import { changeOwnPassword } from "./actions";

export const metadata: Metadata = { title: "เปลี่ยนรหัสผ่าน" };

export default async function ChangePasswordPage({ searchParams }: PageProps<"/account/password">) {
  const user = await requireActiveUser();
  const { error, changed } = await searchParams;
  // AD accounts without a local password change it in the organisation's own system; ours would not reach AD.
  const { passwordHash, ldapId } = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true, ldapId: true } });
  const directoryOnly = !!ldapId && !passwordHash;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-8 px-5 py-12">
      <div className="flex flex-col gap-3">
        <Link href="/organizer" className="-my-2.5 inline-block w-fit py-2.5 text-sm text-muted-foreground underline-offset-4 hover:underline">← กลับ</Link>
        <h1 className="font-heading text-3xl font-bold tracking-tight">เปลี่ยนรหัสผ่าน</h1>
        <p className="text-muted-foreground">{user.name} ({user.email})</p>
      </div>
      {directoryOnly ? (
        <div role="status" className="flex flex-col gap-2 rounded-xl border bg-card p-6 shadow-sm">
          <p className="font-medium">บัญชีนี้เข้าสู่ระบบด้วยรหัสผ่าน AD ของหน่วยงาน</p>
          <p className="text-sm text-muted-foreground">เปลี่ยนรหัสผ่านที่ระบบของหน่วยงานหรือติดต่อฝ่าย IT รหัสใหม่ใช้ได้ตั้งแต่การเข้าสู่ระบบครั้งถัดไป</p>
        </div>
      ) : <form action={changeOwnPassword} className="flex flex-col gap-6 rounded-xl border bg-card p-6 shadow-sm">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="current">รหัสผ่านปัจจุบัน</FieldLabel>
            <Input id="current" name="current" type="password" autoComplete="current-password" required />
          </Field>
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
        {changed === "1" && <p role="status" className="text-sm text-primary">เปลี่ยนรหัสผ่านเรียบร้อยแล้ว</p>}
        {error === "current" && <p role="alert" className="text-sm text-destructive">รหัสผ่านปัจจุบันไม่ถูกต้อง</p>}
        {error === "password" && <p role="alert" className="text-sm text-destructive">รหัสผ่านใหม่ต้องยาวอย่างน้อย 12 ตัวและตรงกันทั้งสองช่อง</p>}
        <Button type="submit" size="lg">บันทึกรหัสผ่านใหม่</Button>
      </form>}
    </main>
  );
}
