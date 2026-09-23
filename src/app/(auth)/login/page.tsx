import type { Metadata } from "next";
import { AuthError } from "next-auth";
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
  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";

    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/organizer",
      });
    } catch (cause) {
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
        {error && <p role="alert" className="text-sm text-destructive">อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกปิดใช้งาน</p>}
        <Button type="submit" size="lg">เข้าสู่ระบบ</Button>
      </form>
    </main>
  );
}
