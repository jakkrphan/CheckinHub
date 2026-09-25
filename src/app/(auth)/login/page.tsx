import type { Metadata } from "next";
import Link from "next/link";
import { AuthError, CredentialsSignin } from "next-auth";
import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "เข้าสู่ระบบ",
};

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const { error, notice } = await searchParams;

  async function login(formData: FormData) {
    "use server";

    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/organizer",
      });
    } catch (cause) {
      if (cause instanceof CredentialsSignin && cause.code === "rate_limited") redirect("/login?error=rate-limited");
      if (cause instanceof AuthError) redirect("/login?error=invalid");
      throw cause;
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-8 px-5 py-12">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-primary">เช็คอินอบรม</p>
        <h1 className="font-heading text-3xl font-bold tracking-tight">เข้าสู่ระบบผู้จัด</h1>
        <p className="text-muted-foreground">ใช้บัญชีที่ผู้ดูแลระบบสร้างให้เพื่อจัดการโครงการหรือเช็คชื่อหน้างาน</p>
      </div>
      <form action={login} className="flex flex-col gap-6 rounded-xl border bg-card p-6 shadow-sm">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">อีเมล</FieldLabel>
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">รหัสผ่าน</FieldLabel>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </Field>
        </FieldGroup>
        {notice === "password-set" && <p role="status" className="text-sm text-primary">ตั้งรหัสผ่านเรียบร้อยแล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error === "rate-limited" ? "พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" : "อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกปิดใช้งาน"}</p>}
        <Button type="submit" size="lg">เข้าสู่ระบบ</Button>
      </form>
      <p className="text-sm text-muted-foreground">ลืมรหัสผ่านหรือยังไม่ได้ตั้งรหัสผ่าน? ติดต่อผู้ดูแลระบบเพื่อขอลิงก์ตั้งรหัสผ่าน · <Link href="/" className="underline underline-offset-4">กลับหน้าแรก</Link></p>
    </main>
  );
}
