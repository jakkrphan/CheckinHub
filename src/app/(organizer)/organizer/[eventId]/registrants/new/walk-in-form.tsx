"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { CheckIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { addManualRegistrant } from "@/app/(organizer)/organizer/[eventId]/registrants/new/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { conditionMatches, sectionHeadings, TEL_ANSWER_PATTERN, type FormPageLayout, type RegistrationFieldConfig } from "@/features/events/registration-fields";
import { cn } from "@/lib/utils";

export type WalkInDay = { id: string; number: number; label: string; remaining: number | null; isClosed: boolean };

const switchClass = "relative h-7 w-12 shrink-0 cursor-pointer appearance-none rounded-full bg-input transition-colors before:absolute before:left-1 before:top-1 before:size-5 before:rounded-full before:bg-card before:shadow before:transition-transform checked:bg-primary checked:before:translate-x-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const wide = (field: RegistrationFieldConfig) => field.type === "textarea" || field.type === "checkbox" || field.type === "radio" || field.type === "file";

/** Walk-in / phone registration by an organizer (mockup B organizer-registrant-add), using the public form's fields. */
export function WalkInForm({ eventId, fields, pages, days, seatMode, courseRemaining, backHref, error }: {
  eventId: string;
  fields: RegistrationFieldConfig[];
  /** Pages of the public form; shown here as section headings on one screen. */
  pages: FormPageLayout[];
  days: WalkInDay[];
  seatMode: "per_day" | "whole_course";
  courseRemaining: number | null;
  backHref: string;
  error?: string;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const headings = sectionHeadings(pages, fields.filter((field) => conditionMatches(field, answers)).map((field) => field.key));
  const [picked, setPicked] = useState<string[]>(() => days.filter((day) => !day.isClosed).length === 1 ? days.filter((day) => !day.isClosed).map((day) => day.id) : []);
  const [approve, setApprove] = useState(true);
  const set = (key: string, value: string | string[]) => setAnswers((previous) => ({ ...previous, [key]: value }));
  const perDay = seatMode === "per_day";
  const pickedFull = perDay ? days.some((day) => picked.includes(day.id) && day.remaining === 0) : courseRemaining === 0;
  const labelOf = (key: string) => fields.find((field) => field.key === key)?.label ?? key;

  return <form action={addManualRegistrant.bind(null, eventId)} className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
    <div className="flex items-start justify-between gap-4 px-6 pt-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-2xl font-bold">เพิ่มผู้ลงทะเบียนเอง</h2>
        <p className="text-sm text-muted-foreground">สำหรับคนที่แจ้งชื่อทางโทรศัพท์หรือ walk-in — ใช้ฟิลด์ชุดเดียวกับฟอร์มสาธารณะ</p>
      </div>
      <Button asChild variant="ghost" size="icon-lg" className="bg-muted"><Link href={backHref} aria-label="ปิด กลับไปหน้าผู้ลงทะเบียน"><XIcon aria-hidden="true" /></Link></Button>
    </div>

    <div className="flex flex-col gap-5 px-6 py-6">
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {perDay ? <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">วันที่เข้าร่วม <span className="text-destructive">*</span></legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {days.map((day) => <label key={day.id} className={cn("flex min-h-12 items-center gap-2.5 rounded-lg border px-3 py-2 text-sm", day.isClosed ? "cursor-not-allowed bg-muted text-muted-foreground" : "cursor-pointer has-checked:border-2 has-checked:border-primary has-checked:bg-accent")}>
            <input type="checkbox" name="dayId" value={day.id} disabled={day.isClosed} checked={picked.includes(day.id)} onChange={(event) => setPicked((current) => event.target.checked ? [...current, day.id] : current.filter((id) => id !== day.id))} className="size-4 shrink-0 accent-primary" />
            <span className="flex min-w-0 flex-col leading-tight"><span className="font-semibold">วันที่ {day.number} · {day.isClosed ? "ปิดรับ" : day.remaining === null ? "ไม่จำกัด" : day.remaining === 0 ? "เต็ม" : `เหลือ ${day.remaining.toLocaleString("th-TH")}`}</span><span className="truncate text-xs text-muted-foreground">{day.label}</span></span>
          </label>)}
        </div>
      </fieldset> : <div className="rounded-lg border bg-accent/60 px-4 py-3 text-sm"><strong>หลักสูตรต่อเนื่อง · ลงครบทุกวัน</strong> ({days.length} วัน) · ที่นั่งคงเหลือ {courseRemaining === null ? "ไม่จำกัด" : courseRemaining === 0 ? "เต็ม" : courseRemaining.toLocaleString("th-TH")}</div>}

      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        {fields.map((field) => {
          if (!conditionMatches(field, answers)) return null;
          const heading = headings.get(field.key);
          const id = `answer-${field.key}`;
          const name = `answer:${field.key}`;
          const values = field.conditional ? [field.conditional.value].flat() : [];
          return <Fragment key={field.key}>{heading && <h3 className="border-b pb-1.5 font-heading text-base font-bold sm:col-span-2">{heading}</h3>}<div className={cn("flex flex-col gap-2", wide(field) && "sm:col-span-2")}>
            <label htmlFor={field.type === "checkbox" || field.type === "radio" ? undefined : id} className="text-sm font-semibold">{field.label}{field.required && <span className="text-destructive"> *</span>}</label>
            {field.type === "textarea" ? <Textarea id={id} name={name} required={field.required} maxLength={3000} rows={3} onChange={(event) => set(field.key, event.target.value)} />
              : field.type === "select" ? <NativeSelect id={id} name={name} required={field.required} defaultValue="" className="h-11" onChange={(event) => set(field.key, event.target.value)}><option value="">เลือกคำตอบ</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</NativeSelect>
              : field.type === "radio" ? <div role="radiogroup" aria-label={field.label} aria-required={field.required} className="flex flex-wrap gap-x-5 gap-y-2">{field.options?.map((option) => <label key={option} className="flex min-h-9 items-center gap-2 text-sm"><input type="radio" name={name} value={option} required={field.required} className="size-4 accent-primary" onChange={() => set(field.key, option)} />{option}</label>)}</div>
              : field.type === "checkbox" ? <div role="group" aria-label={field.label} className="flex flex-wrap gap-x-5 gap-y-2">{field.options?.map((option) => <label key={option} className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} value={option} className="size-4 accent-primary" onChange={(event) => {
                  const selected = Array.isArray(answers[field.key]) ? answers[field.key] as string[] : [];
                  set(field.key, event.target.checked ? [...selected, option] : selected.filter((item) => item !== option));
                }} />{option}</label>)}</div>
              : field.type === "file" ? <><Input id={id} name={name} type="file" multiple={(field.maxFiles ?? 1) > 1} required={field.required} accept={field.acceptedFileTypes?.map((type) => `.${type.replace(/^\./, "")}`).join(",")} /><span className="text-xs text-muted-foreground">ไฟล์ {field.acceptedFileTypes?.join(", ")} · ไม่เกิน {field.maxFileSizeMb} MB{(field.maxFiles ?? 1) > 1 ? ` ต่อไฟล์ · สูงสุด ${field.maxFiles} ไฟล์` : ""}</span></>
              : <Input id={id} name={name} type={field.type} required={field.required} pattern={field.type === "tel" ? TEL_ANSWER_PATTERN : undefined} title={field.type === "tel" ? "เบอร์โทรศัพท์ 6–30 ตัว: ตัวเลข เว้นวรรค และ + - ( )" : undefined} maxLength={field.type === "tel" ? 30 : 3000} className="h-11" onChange={(event) => set(field.key, event.target.value)} />}
            {field.conditional && <span className="text-xs text-muted-foreground">ฟิลด์เงื่อนไข — แสดงเพราะ {labelOf(field.conditional.field)} = {values.join(" / ")}</span>}
          </div></Fragment>;
        })}
        <div className="flex flex-col gap-2 sm:col-span-2">
          <label htmlFor="walkin-email" className="text-sm font-semibold">อีเมลสำหรับส่ง QR</label>
          <Input id="walkin-email" name="email" type="email" autoComplete="off" maxLength={191} className="h-11" />
          <span className="text-xs text-muted-foreground">เว้นว่างได้ถ้าจะให้ผู้จัดพิมพ์ QR ให้เอง · ถ้ากรอก ระบบใช้กันลงทะเบียนซ้ำ</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-accent px-4 py-3.5">
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="flex flex-col gap-0.5"><span className="font-semibold text-accent-foreground">อนุมัติทันที + ออก QR</span><span className="text-xs text-accent-foreground/80">ปิดไว้ = เข้าคิวรออนุมัติเหมือนคนที่กรอกฟอร์มเอง</span></span>
          <input type="checkbox" role="switch" name="approveNow" checked={approve} onChange={(event) => setApprove(event.target.checked)} className={switchClass} />
        </label>
        {approve && <label className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm", pickedFull ? "border-amber-300 bg-amber-50 text-amber-950" : "border-transparent bg-card/70")}>
          <input type="checkbox" name="overrideCapacity" className="mt-0.5 size-4 shrink-0 accent-primary" />
          <span className="flex flex-col gap-0.5"><span className="flex items-center gap-1.5 font-semibold">{pickedFull && <TriangleAlertIcon className="size-4" aria-hidden="true" />}อนุมัติเกินที่นั่ง (กรณีจำเป็น)</span><span className="text-xs opacity-80">{pickedFull ? "วันที่เลือกเต็มแล้ว — ถ้าไม่ติ๊ก ระบบจะจัดเข้าคิวสำรองแทน" : "ใช้เมื่อที่นั่งเต็ม ระบบอนุมัติเกินจำนวนและบันทึกไว้ใน audit log"}</span></span>
        </label>}
      </div>

      <label className="flex items-start gap-2.5 py-1 text-sm"><input type="checkbox" name="consent" required className="mt-0.5 size-4 shrink-0 accent-primary" /><span>ยืนยันว่าได้รับความยินยอมจากผู้เข้าร่วมให้บันทึกข้อมูลเพื่อการลงทะเบียนและเช็คชื่อแล้ว <span className="text-destructive">*</span></span></label>
    </div>

    <div className="flex flex-wrap items-center justify-end gap-2.5 border-t bg-muted/40 px-6 py-4">
      <Button asChild variant="outline" size="lg"><Link href={backHref}>ยกเลิก</Link></Button>
      <Button type="submit" size="lg" disabled={perDay && picked.length === 0}><CheckIcon data-icon="inline-start" aria-hidden="true" />{approve ? "บันทึก + ออก QR" : "บันทึก"}</Button>
    </div>
  </form>;
}
