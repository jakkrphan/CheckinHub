import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { answerProblemMessage, formPageLayout, readFileAnswers, readRegistrationFields, readRegistrationForm } from "@/features/events/registration-fields";
import { db } from "@/server/db";
import { canSelfEdit } from "@/server/registrations/self-edit";
import { isFeatureEnabled } from "@/server/settings/features";

import { updateOwnAnswersAction } from "../actions";
import { EditAnswersForm } from "./edit-answers-form";
import { statusTokenWhere } from "@/server/registrations/status-token";

export const metadata: Metadata = { title: "แก้ไขข้อมูลการลงทะเบียน", referrer: "no-referrer" };

const deadlineFormatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Bangkok" });

export default async function EditAnswersPage({ params, searchParams }: PageProps<"/events/[slug]/status/[token]/edit">) {
  const { slug, token } = await params;
  const { error, field: problemKey, reason } = await searchParams;
  const registrant = await db.registrant.findUnique({
    where: await statusTokenWhere(token),
    select: { status: true, anonymizedAt: true, answers: true, event: { select: { slug: true, title: true, status: true, registrationDeadline: true, deletedAt: true, fields: true, fieldsVersion: true } } },
  });
  if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt) notFound();
  const statusUrl = `/events/${slug}/status/${token}`;
  const featureOn = await isFeatureEnabled("selfEdit");
  const editable = featureOn && canSelfEdit(registrant, registrant.event);
  const fields = readRegistrationFields(registrant.event.fields);
  const stored = registrant.answers && typeof registrant.answers === "object" && !Array.isArray(registrant.answers) ? registrant.answers as Record<string, unknown> : {};
  const initial: Record<string, string | string[]> = {};
  const files: Record<string, string> = {};
  for (const field of fields) {
    const value = stored[field.key];
    if (typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string"))) initial[field.key] = value as string | string[];
    else if (field.type === "file" && readFileAnswers(value).length) files[field.key] = readFileAnswers(value).map((file) => file.originalName).join(", ");
  }
  // Required questions this person never answered were added by the organizer after they registered.
  const newFields = fields.filter((field) => field.required && field.type !== "file" && !(field.key in stored)).map((field) => field.key);
  const problemField = typeof problemKey === "string" ? fields.find((field) => field.key === problemKey) : undefined;
  const problem = problemField ? { key: problemField.key, message: answerProblemMessage(problemField, reason === "required" ? "required" : "invalid") } : undefined;

  return <main className="mx-auto flex min-h-svh w-full max-w-lg md:my-10 md:min-h-0 md:max-w-xl md:overflow-clip md:rounded-2xl md:border md:shadow-sm lg:max-w-2xl flex-col bg-background">
    <header className="flex flex-col gap-2 bg-sidebar px-5 py-5 text-sidebar-foreground">
      <Link href={statusUrl} className="-my-3 w-fit py-3 text-xs text-sidebar-foreground/70 hover:underline">← กลับไปหน้าสถานะ</Link>
      <p className="text-xs text-sidebar-foreground/70">แก้ไขข้อมูลการลงทะเบียน</p>
      <h1 className="font-heading text-lg font-bold leading-snug">{registrant.event.title}</h1>
    </header>
    <div className="flex flex-col gap-4 px-5 py-6">
      {!editable ? <p role="status" className="rounded-xl border bg-card p-5 text-sm">{featureOn ? "แก้ไขข้อมูลไม่ได้แล้ว เนื่องจากปิดรับลงทะเบียน หรือการลงทะเบียนถูกยกเลิก/ไม่อนุมัติ" : "ขณะนี้ปิดการแก้ข้อมูลด้วยตนเอง"} หากต้องการแก้ข้อมูลกรุณาติดต่อผู้จัด</p> : <>
        <p className="text-sm text-muted-foreground">แก้ไขได้จนถึง {deadlineFormatter.format(registrant.event.registrationDeadline!)}</p>
        {(error === "invalid" || error === "form-changed") && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error === "form-changed" ? "ผู้จัดเพิ่งแก้แบบฟอร์มระหว่างที่คุณเปิดหน้านี้ — แบบฟอร์มด้านล่างเป็นฉบับล่าสุดแล้ว กรุณาตรวจแล้วบันทึกอีกครั้ง" : "บันทึกไม่ได้ กรุณาตรวจคำตอบอีกครั้ง"}{problem ? ` · ${problem.message}` : ""}</p>}
        {newFields.length > 0 && <p className="rounded-lg border bg-muted/60 p-3 text-sm">{`ผู้จัดเพิ่มคำถามบังคับหลังจากคุณลงทะเบียน ${newFields.length} ข้อ (ทำเครื่องหมาย "ใหม่") — ต้องตอบก่อนบันทึกการแก้ไข`}</p>}
        <EditAnswersForm action={updateOwnAnswersAction.bind(null, slug, token)} fields={fields} pages={formPageLayout(readRegistrationForm(registrant.event.fields))} initial={initial} files={files} fieldsVersion={registrant.event.fieldsVersion} newFields={newFields} problem={problem} />
      </>}
    </div>
  </main>;
}
