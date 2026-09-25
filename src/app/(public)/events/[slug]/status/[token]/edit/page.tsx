import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { readRegistrationFields } from "@/features/events/registration-fields";
import { db } from "@/server/db";
import { hashBearerCode } from "@/server/registrations/registration";
import { canSelfEdit } from "@/server/registrations/self-edit";

import { updateOwnAnswersAction } from "../actions";
import { EditAnswersForm } from "./edit-answers-form";

export const metadata: Metadata = { title: "แก้ไขข้อมูลการลงทะเบียน", referrer: "no-referrer" };

const deadlineFormatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Bangkok" });

export default async function EditAnswersPage({ params, searchParams }: PageProps<"/events/[slug]/status/[token]/edit">) {
  const { slug, token } = await params;
  const { error } = await searchParams;
  const registrant = await db.registrant.findUnique({
    where: { statusTokenHash: hashBearerCode(token) },
    select: { status: true, anonymizedAt: true, answers: true, event: { select: { slug: true, title: true, status: true, registrationDeadline: true, deletedAt: true, fields: true } } },
  });
  if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt) notFound();
  const statusUrl = `/events/${slug}/status/${token}`;
  const editable = canSelfEdit(registrant, registrant.event);
  const fields = readRegistrationFields(registrant.event.fields);
  const stored = registrant.answers && typeof registrant.answers === "object" && !Array.isArray(registrant.answers) ? registrant.answers as Record<string, unknown> : {};
  const initial: Record<string, string | string[]> = {};
  const files: Record<string, string> = {};
  for (const field of fields) {
    const value = stored[field.key];
    if (typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string"))) initial[field.key] = value as string | string[];
    else if (value && typeof value === "object" && typeof (value as { originalName?: unknown }).originalName === "string") files[field.key] = (value as { originalName: string }).originalName;
  }

  return <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col bg-background">
    <header className="flex flex-col gap-2 bg-sidebar px-5 py-5 text-sidebar-foreground">
      <Link href={statusUrl} className="text-xs text-sidebar-foreground/70 hover:underline">← กลับไปหน้าสถานะ</Link>
      <p className="text-xs text-sidebar-foreground/70">แก้ไขข้อมูลการลงทะเบียน</p>
      <h1 className="font-heading text-lg font-bold leading-snug">{registrant.event.title}</h1>
    </header>
    <div className="flex flex-col gap-4 px-5 py-6">
      {!editable ? <p role="status" className="rounded-xl border bg-card p-5 text-sm">แก้ไขข้อมูลไม่ได้แล้ว เนื่องจากปิดรับลงทะเบียน หรือการลงทะเบียนถูกยกเลิก/ไม่อนุมัติ หากต้องการแก้ข้อมูลกรุณาติดต่อผู้จัด</p> : <>
        <p className="text-sm text-muted-foreground">แก้ไขได้จนถึง {deadlineFormatter.format(registrant.event.registrationDeadline!)}</p>
        {error === "invalid" && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">กรุณาตรวจคำตอบที่บังคับกรอกและรูปแบบข้อมูลอีกครั้ง</p>}
        <EditAnswersForm action={updateOwnAnswersAction.bind(null, slug, token)} fields={fields} initial={initial} files={files} />
      </>}
    </div>
  </main>;
}
