"use client";

import { useRef, useState, type FormEvent } from "react";
import { CheckIcon, MailIcon } from "lucide-react";

import { registerPublicEvent } from "@/app/(public)/events/[slug]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { conditionMatches, type RegistrationFieldConfig } from "@/features/events/registration-fields";
import { CURRENT_CONSENT_TEXT } from "@/features/registrations/consent";
import { cn } from "@/lib/utils";

type DayOption = { id: string; date: string; label: string; remaining: number | null; maxSeats: number | null; isClosed: boolean };
type Step = 1 | 2 | 3;

const weekdayFormatter = new Intl.DateTimeFormat("th-TH", { weekday: "short", timeZone: "UTC" });
const monthFormatter = new Intl.DateTimeFormat("th-TH", { month: "short", timeZone: "UTC" });

export function PublicRegistrationWizard({ slug, formTicket, fields, days, captchaSiteKey, deadline, autoApprove, seatMode, courseRemaining, courseMaxSeats, attendanceThreshold }: {
  slug: string;
  formTicket: string;
  fields: RegistrationFieldConfig[];
  days: DayOption[];
  captchaSiteKey: string;
  deadline: string;
  autoApprove: boolean;
  seatMode: string;
  courseRemaining: number | null;
  courseMaxSeats: number | null;
  attendanceThreshold: number | null;
}) {
  const [step, setStep] = useState<Step>(1);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [wizardError, setWizardError] = useState("");
  const answerSection = useRef<HTMLElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const consentInput = useRef<HTMLInputElement>(null);
  const visibleFields = fields.filter((field) => conditionMatches(field, answers));

  function nextStep() {
    setWizardError("");
    if (step === 1) {
      if (seatMode !== "whole_course" && selectedDays.length === 0) { setWizardError("กรุณาเลือกวันที่เข้าร่วมอย่างน้อย 1 วัน"); return; }
      setStep(2);
      return;
    }
    const unansweredCheckbox = visibleFields.find((field) => field.type === "checkbox" && field.required && (!Array.isArray(answers[field.key]) || answers[field.key].length === 0));
    if (unansweredCheckbox) { setWizardError(`กรุณาเลือกคำตอบของ “${unansweredCheckbox.label}”`); return; }
    const controls = answerSection.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not(:disabled), textarea:not(:disabled), select:not(:disabled)");
    const invalid = Array.from(controls ?? []).find((control) => !control.checkValidity());
    if (invalid) { invalid.reportValidity(); return; }
    setStep(3);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (step !== 3) { event.preventDefault(); nextStep(); return; }
    if (seatMode !== "whole_course" && selectedDays.length === 0) { event.preventDefault(); setStep(1); setWizardError("กรุณาเลือกวันที่เข้าร่วม"); return; }
    if (!emailInput.current?.checkValidity()) { event.preventDefault(); emailInput.current?.reportValidity(); return; }
    if (!consentInput.current?.checked) { event.preventDefault(); consentInput.current?.reportValidity(); }
  }

  return (
    <form action={registerPublicEvent.bind(null, slug)} noValidate onSubmit={handleSubmit} className="flex flex-col">
      <input type="hidden" name="formTicket" value={formTicket} />
      <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden"><label htmlFor="public-website">เว็บไซต์</label><input id="public-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" /></div>
      <div className="flex flex-col gap-3 border-b bg-card px-5 py-4">
        <div className="flex gap-1" role="progressbar" aria-label="ขั้นตอนลงทะเบียน" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}>{[1, 2, 3].map((number) => <span key={number} className={cn("h-1 flex-1 rounded-full", number <= step ? "bg-primary" : "bg-border")} />)}</div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><strong>ขั้นที่ {step}/3 · {step === 1 ? seatMode === "whole_course" ? "วันอบรมทั้งหลักสูตร" : "เลือกวันที่จะเข้าร่วม" : step === 2 ? "ข้อมูลผู้ลงทะเบียน" : "ยืนยันการลงทะเบียน"}</strong><span className="text-muted-foreground">ปิดรับ {deadline}</span></div>
      </div>

      <section className={cn("flex flex-col gap-3 px-5 py-5", step !== 1 && "hidden")} aria-label="เลือกวันที่เข้าร่วม">
        {seatMode === "whole_course" ? <div className="rounded-lg border border-primary bg-accent p-4 text-sm"><strong>หลักสูตรต่อเนื่อง ต้องเข้าร่วมครบทุกวัน</strong><p className="mt-1">{courseRemaining === null ? "ไม่จำกัดที่นั่ง" : courseRemaining === 0 ? "ที่นั่งเต็ม · สมัครเพื่อเข้าคิวสำรองได้" : `เหลือ ${courseRemaining} / ${courseMaxSeats} ที่นั่ง`}</p>{attendanceThreshold !== null && <p className="mt-1 text-muted-foreground">ต้องเช็คชื่ออย่างน้อย {attendanceThreshold}% ของรอบทั้งหมดจึงผ่านเกณฑ์</p>}</div> : <p className="text-sm text-muted-foreground">เลือกได้หลายวัน อย่างน้อย 1 วัน · ที่นั่งนับแยกแต่ละวัน</p>}
        <fieldset className="flex flex-col gap-3"><legend className="sr-only">วันที่เข้าร่วม</legend>
          {days.map((day, index) => {
            const date = new Date(`${day.date}T00:00:00Z`);
            const selected = selectedDays.includes(day.id);
            return <label key={day.id} className={cn("flex items-center gap-4 rounded-xl border bg-card p-4", seatMode === "whole_course" ? "cursor-default" : day.isClosed ? "cursor-not-allowed opacity-60" : "cursor-pointer", selected && "border-primary bg-primary text-primary-foreground")}>
              {seatMode !== "whole_course" && <input type="checkbox" name="dayId" value={day.id} checked={selected} disabled={day.isClosed} onChange={(event) => { setSelectedDays((current) => event.target.checked ? [...current, day.id] : current.filter((id) => id !== day.id)); setWizardError(""); }} className="sr-only" />}
              <span className={cn("flex w-14 shrink-0 flex-col items-center rounded-lg bg-secondary px-1 py-2 text-xs", selected && "bg-primary-foreground/15 text-primary-foreground")}><span>{weekdayFormatter.format(date)}</span><strong className="font-heading text-2xl">{date.getUTCDate()}</strong><span>{monthFormatter.format(date)}</span></span>
              <span className="flex min-w-0 flex-1 flex-col gap-1"><strong>วันที่ {index + 1}</strong><span className="text-xs">{seatMode === "whole_course" ? day.label : day.isClosed ? "ปิดรับลงทะเบียนวันนี้" : day.remaining === null ? "ไม่จำกัดที่นั่ง" : day.remaining === 0 ? "เต็ม · เลือกได้เพื่อเข้าคิวสำรอง" : `เหลือ ${day.remaining} จาก ${day.maxSeats} ที่นั่ง`}</span></span>
              {seatMode !== "whole_course" && (day.isClosed ? <Badge variant="secondary">ปิดรับ</Badge> : selected ? <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-foreground text-primary"><CheckIcon className="size-4" aria-hidden="true" /></span> : day.remaining === 0 ? <Badge variant="destructive">เต็ม</Badge> : <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-2 border-input" />)}
            </label>;
          })}
        </fieldset>
      </section>

      <section ref={answerSection} className={cn("flex flex-col gap-5 px-5 py-5", step !== 2 && "hidden")} aria-label="ข้อมูลผู้ลงทะเบียน">
        <div className="rounded-lg bg-accent px-4 py-3 text-sm text-accent-foreground">{seatMode === "whole_course" ? `สมัครเข้าร่วมหลักสูตรครบ ${days.length} วัน` : `เลือกแล้ว ${selectedDays.length} วัน · กดย้อนกลับเพื่อแก้ไขวัน`}</div>
        <FieldGroup>
          {visibleFields.map((field) => {
            const name = `answer:${field.key}`;
            return <Field key={field.key} className={field.conditional ? "rounded-xl bg-accent p-4" : undefined}>
              <FieldLabel htmlFor={`public-answer-${field.key}`}>{field.label}{field.required ? " *" : ""}</FieldLabel>
              {field.type === "textarea" ? <Textarea id={`public-answer-${field.key}`} name={name} required={field.required} maxLength={3000} rows={4} onChange={(event) => setAnswers((current) => ({ ...current, [field.key]: event.target.value }))} />
                : field.type === "select" ? <NativeSelect id={`public-answer-${field.key}`} name={name} required={field.required} defaultValue="" onChange={(event) => setAnswers((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">เลือกคำตอบ</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</NativeSelect>
                : field.type === "checkbox" ? <div className="flex flex-col gap-2">{field.options?.map((option) => <label key={option} className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} value={option} className="size-4 accent-primary" onChange={(event) => setAnswers((current) => { const selected = Array.isArray(current[field.key]) ? current[field.key] as string[] : []; return { ...current, [field.key]: event.target.checked ? [...selected, option] : selected.filter((item) => item !== option) }; })} />{option}</label>)}{field.required && <FieldDescription>เลือกอย่างน้อยหนึ่งข้อ</FieldDescription>}</div>
                : field.type === "file" ? <Input id={`public-answer-${field.key}`} name={name} type="file" disabled />
                : <Input id={`public-answer-${field.key}`} name={name} type={field.type} required={field.required} maxLength={field.type === "tel" ? 30 : 3000} onChange={(event) => setAnswers((current) => ({ ...current, [field.key]: event.target.value }))} />}
            </Field>;
          })}
        </FieldGroup>
      </section>

      <section className={cn("flex flex-col gap-4 px-5 py-5", step !== 3 && "hidden")} aria-label="ยืนยันการลงทะเบียน">
        <div className="flex flex-col gap-4 rounded-xl border border-primary bg-card p-4">
          <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-accent text-primary"><MailIcon className="size-5" aria-hidden="true" /></span><div className="flex flex-col"><strong>อีเมลสำหรับติดต่อ</strong><span className="text-xs text-muted-foreground">ใช้ระบุตัวตนผู้ลงทะเบียนและติดต่อกลับ</span></div></div>
          <Field><FieldLabel htmlFor="public-email">อีเมล</FieldLabel><Input ref={emailInput} id="public-email" name="email" type="email" autoComplete="email" maxLength={191} required /></Field>
        </div>
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">LINE Login และการส่ง QR ทางอีเมลยังไม่เปิดใช้ใน local flow หลังส่งใบสมัคร กรุณาบันทึกลิงก์หน้าสถานะที่ระบบแสดงไว้</div>
        <Field orientation="horizontal" className="rounded-xl border bg-card p-4"><input ref={consentInput} id="public-consent" name="consent" type="checkbox" className="mt-1 size-4 accent-primary" required /><FieldLabel htmlFor="public-consent" className="leading-relaxed">{CURRENT_CONSENT_TEXT} *</FieldLabel></Field>
        {captchaSiteKey ? <div className="cf-turnstile" data-sitekey={captchaSiteKey} /> : <p className="text-xs text-muted-foreground">โหมดทดสอบในเครื่อง: ยังไม่ได้เชื่อม Cloudflare Turnstile</p>}
        <p className="text-xs text-muted-foreground">{autoApprove ? "หากยังมีที่นั่ง ระบบจะแสดง QR ในหน้าสถานะหลังส่งใบสมัคร" : "โครงการนี้ให้ผู้จัดอนุมัติก่อน จึงจะเห็น QR ในหน้าสถานะ"}</p>
      </section>

      {wizardError && <p role="alert" className="px-5 text-sm text-destructive">{wizardError}</p>}
      <footer className="sticky bottom-0 flex items-center gap-3 border-t bg-card px-5 py-4">
        {step > 1 && <Button type="button" variant="outline" onClick={() => { setStep(step === 3 ? 2 : 1); setWizardError(""); }}>ย้อนกลับ</Button>}
        {step < 3 ? <Button type="button" size="lg" className="flex-1" onClick={nextStep}>{step === 1 ? seatMode === "whole_course" ? `ถัดไป · สมัครทั้ง ${days.length} วัน` : `ถัดไป · เลือกแล้ว ${selectedDays.length} วัน` : "ถัดไป · ยืนยันข้อมูล"}</Button> : <Button type="submit" size="lg" className="flex-1">ยืนยันการลงทะเบียน</Button>}
      </footer>
    </form>
  );
}
