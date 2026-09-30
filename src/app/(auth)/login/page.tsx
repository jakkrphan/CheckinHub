import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck2Icon, CheckIcon, QrCodeIcon, ShieldCheckIcon } from "lucide-react";

import { auth } from "@/auth";
import { ldapEnabled } from "@/server/auth/ldap";
import { safeReturnTo } from "@/server/auth/return-to";
import { db } from "@/server/db";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

const features = [
  { icon: CalendarCheck2Icon, text: "สร้างโครงการ ตั้งวัน ที่นั่ง และฟอร์มลงทะเบียน" },
  { icon: QrCodeIcon, text: "เช็คชื่อหน้างานด้วยกล้อง เครื่องยิง หรือค้นหาชื่อ" },
  { icon: ShieldCheckIcon, text: "ทุกการเข้าถึงข้อมูลส่วนบุคคลถูกบันทึกตรวจสอบได้" },
];

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, notice, next: nextParam } = await searchParams;
  const next = safeReturnTo(nextParam);
  const session = await auth();
  if (session?.user?.id && error !== "inactive") {
    const user = await db.user.findUnique({ where: { id: session.user.id }, select: { isActive: true } });
    if (user?.isActive) redirect(next ?? "/organizer");
  }
  const ldap = ldapEnabled();

  return (
    <main className="grid min-h-svh w-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex" aria-label="เกี่ยวกับระบบ">
        <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><CheckIcon className="size-6" aria-hidden="true" /></span><span className="font-heading text-xl font-bold">CheckInHub</span></div>
        <div className="flex max-w-md flex-col gap-6">
          <h2 className="font-heading text-3xl font-bold leading-snug">ระบบลงทะเบียนและเช็คชื่อผู้เข้าอบรม</h2>
          <ul className="flex flex-col gap-4">{features.map(({ icon: Icon, text }) => <li key={text} className="flex items-start gap-3 text-sidebar-foreground/85"><Icon className="mt-0.5 size-5 shrink-0 text-sidebar-primary" aria-hidden="true" />{text}</li>)}</ul>
        </div>
        <p className="text-xs text-sidebar-foreground/60">สำหรับเจ้าหน้าที่และผู้จัดโครงการ · ผู้เข้าอบรมไม่ต้องเข้าสู่ระบบ</p>
      </section>
      <section className="flex items-center justify-center px-5 py-12">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 lg:hidden"><span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><CheckIcon className="size-5" aria-hidden="true" /></span><span className="font-heading font-bold">CheckInHub</span></div>
            <h1 className="font-heading text-3xl font-bold tracking-tight">เข้าสู่ระบบ</h1>
            <p className="text-muted-foreground">{ldap ? "ใช้ชื่อผู้ใช้และรหัสผ่านเดียวกับที่เข้าคอมพิวเตอร์ของหน่วยงาน (AD)" : "ใช้บัญชีที่ผู้ดูแลระบบสร้างให้"} เพื่อจัดการโครงการหรือเช็คชื่อหน้างาน</p>
          </div>
          {next && !error && <p role="status" className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">กรุณาเข้าสู่ระบบเพื่อไปยังหน้าที่เปิดไว้ต่อ</p>}
          {error === "inactive" && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">บัญชีนี้ถูกปิดใช้งานหรือหมดสิทธิ์แล้ว กรุณาติดต่อผู้ดูแลระบบ</p>}
          {notice === "password-set" && <p role="status" className="rounded-lg border border-primary/30 bg-accent px-3 py-2 text-sm text-accent-foreground">ตั้งรหัสผ่านเรียบร้อยแล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย</p>}
          <LoginForm next={next} ldap={ldap} />
          <p className="text-sm leading-relaxed text-muted-foreground">{ldap ? "ลืมรหัสผ่าน AD? ติดต่อฝ่าย IT ของหน่วยงาน" : "ลืมรหัสผ่านหรือยังไม่ได้ตั้งรหัสผ่าน? ขอลิงก์ตั้งรหัสผ่านจากผู้ดูแลระบบ"} · <Link href="/" className="underline underline-offset-4 hover:text-foreground">กลับหน้าแรก</Link></p>
        </div>
      </section>
    </main>
  );
}
