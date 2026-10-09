"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckIcon, MailIcon, MessageCircleIcon } from "lucide-react";

import { registerPublicEvent } from "@/app/(public)/events/[slug]/actions";
import { CourseOverview } from "@/app/(public)/events/[slug]/course-overview";
import { PublicFileField } from "@/app/(public)/events/[slug]/public-file-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { answerMaxLength, answerProblemMessage, conditionMatches, DEFAULT_FORM_PAGE_TITLE, TEL_ANSWER_PATTERN, type FormPageLayout, type RegistrationFieldConfig } from "@/features/events/registration-fields";
import { CURRENT_CONSENT_TEXT } from "@/features/registrations/consent";
import { cn } from "@/lib/utils";

type DayOption = { id: string; date: string; label: string; schedule: string | null; remaining: number | null; maxSeats: number | null; isClosed: boolean };
/** 1 = days, 2…n-1 = one step per form page, n = email and confirmation. */
type Step = number;

// Fixed Thai name tables: Intl output differs between Node ICU and browser ICU (e.g. "พฤหัส" vs "พฤ."), which breaks hydration.
const weekdayCard = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
const weekdayShort = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const monthsShort = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const utcDate = (date: string) => new Date(`${date}T00:00:00Z`);
const shortDate = (date: string) => { const value = utcDate(date); return `${weekdayShort[value.getUTCDay()]} ${value.getUTCDate()} ${monthsShort[value.getUTCMonth()]}`; };

const controlClass = "h-12 rounded-lg bg-card px-3.5 text-base md:text-base";

/** Consecutive conditional fields that depend on the same parent answer are grouped into one tinted box. */
function groupByParent(fields: RegistrationFieldConfig[]) {
  const groups: { parent: string | null; fields: RegistrationFieldConfig[] }[] = [];
  for (const field of fields) {
    const parent = field.conditional?.field ?? null;
    const last = groups.at(-1);
    if (parent && last?.parent === parent) last.fields.push(field);
    else groups.push({ parent, fields: [field] });
  }
  return groups;
}

export function PublicRegistrationWizard({ slug, formTicket, fieldsVersion, fields, pages, days, lineEnabled, deadline, autoApprove, waitlistEnabled, seatMode, courseRemaining, courseMaxSeats, title, typeLabel, cover, details, notice }: {
  slug: string;
  formTicket: string;
  /** Lets the server recognise a submission made from a page opened before the organizer changed the form. */
  fieldsVersion: number;
  fields: RegistrationFieldConfig[];
  /** How the organizer split the form into pages; one page when the form has no page breaks. */
  pages: FormPageLayout[];
  days: DayOption[];
  /** LINE notifications are on: the confirm step offers LINE as the channel for the QR and results. */
  lineEnabled: boolean;
  deadline: string;
  autoApprove: boolean;
  /** Off: full days cannot be picked and a full course cannot be joined. */
  waitlistEnabled: boolean;
  seatMode: string;
  courseRemaining: number | null;
  courseMaxSeats: number | null;
  title: string;
  typeLabel: string;
  cover: ReactNode;
  details: ReactNode;
  notice: string | null;
}) {
  const [currentStep, setStep] = useState<Step>(1);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [wizardError, setWizardError] = useState("");
  const [channel, setChannel] = useState<"EMAIL" | "LINE">("EMAIL");
  const form = useRef<HTMLFormElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const consentInput = useRef<HTMLInputElement>(null);
  const visibleFields = fields.filter((field) => conditionMatches(field, answers));
  const chosenDays = days.map((day, index) => ({ ...day, number: index + 1 })).filter((day) => selectedDays.includes(day.id));

  // Only pages with a field to show become steps: a page whose fields are all hidden by conditions is skipped.
  const shownByKey = new Map(visibleFields.map((field) => [field.key, field]));
  // `id` is the page's place in the organizer's layout: a stable React key, so answers on a page survive when an earlier
  // answer shows or hides one of its fields (a key from the first visible field would remount the page and clear it).
  const shownPages = pages.map((page, index) => ({ id: `page-${index}`, title: page.title || DEFAULT_FORM_PAGE_TITLE, fields: page.keys.flatMap((key) => shownByKey.get(key) ?? []) })).filter((page) => page.fields.length > 0);
  const formPages = shownPages.length ? shownPages : [{ id: "page-empty", title: DEFAULT_FORM_PAGE_TITLE, fields: [] as RegistrationFieldConfig[] }];
  const lastStep = formPages.length + 2;
  // An earlier answer can remove a later page while the user is on it.
  const step = Math.min(currentStep, lastStep);
  const currentPage = step > 1 && step < lastStep ? formPages[step - 2] : null;
  const stepTitle = step === 1 ? seatMode === "whole_course" ? "รายละเอียดหลักสูตร" : "เลือกวันที่จะเข้าร่วม" : currentPage ? currentPage.title : "ยืนยันการลงทะเบียน";

  const courseFull = seatMode === "whole_course" && courseRemaining === 0 && !waitlistEnabled;

  function goTo(next: Step) {
    setStep(next);
    setWizardError("");
    window.scrollTo({ top: 0 });
  }

  function nextStep() {
    setWizardError("");
    if (step === 1) {
      if (courseFull) { setWizardError("ที่นั่งของหลักสูตรเต็มแล้ว โครงการนี้ไม่เปิดรับรอคิว"); return; }
      if (seatMode !== "whole_course" && selectedDays.length === 0) { setWizardError("กรุณาเลือกวันที่เข้าร่วมอย่างน้อย 1 วัน"); return; }
      goTo(2);
      return;
    }
    // Only the page on screen is checked; the pages before it were checked when the user left them.
    const unansweredCheckbox = currentPage?.fields.find((field) => field.type === "checkbox" && field.required && (!Array.isArray(answers[field.key]) || answers[field.key].length === 0));
    if (unansweredCheckbox) { setWizardError(`กรุณาเลือกคำตอบของ “${unansweredCheckbox.label}”`); return; }
    const controls = form.current?.querySelector(`[data-form-page="${step - 2}"]`)?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not(:disabled), textarea:not(:disabled), select:not(:disabled)");
    const invalid = Array.from(controls ?? []).find((control) => !control.checkValidity());
    if (invalid) {
      if (invalid instanceof HTMLInputElement && invalid.type === "file") { invalid.focus(); setWizardError(`กรุณาแนบไฟล์ “${fields.find((field) => `answer:${field.key}` === invalid.name)?.label ?? ""}”`); return; }
      const field = fields.find((item) => `answer:${item.key}` === invalid.name);
      if (field) setWizardError(answerProblemMessage(field, invalid.validity.valueMissing ? "required" : "invalid"));
      invalid.reportValidity();
      return;
    }
    goTo(step + 1);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (step !== lastStep) { event.preventDefault(); nextStep(); return; }
    if (seatMode !== "whole_course" && selectedDays.length === 0) { event.preventDefault(); goTo(1); setWizardError("กรุณาเลือกวันที่เข้าร่วม"); return; }
    if (channel === "EMAIL" && !emailInput.current?.checkValidity()) { event.preventDefault(); emailInput.current?.reportValidity(); return; }
    if (!consentInput.current?.checked) { event.preventDefault(); consentInput.current?.reportValidity(); }
  }

  function renderField(field: RegistrationFieldConfig) {
    const name = `answer:${field.key}`;
    const id = `public-answer-${field.key}`;
    const setAnswer = (value: string) => setAnswers((current) => ({ ...current, [field.key]: value }));
    return <Field key={field.key} className="gap-1.5">
      <FieldLabel htmlFor={field.type === "checkbox" || field.type === "radio" ? undefined : id} className="gap-1 text-sm font-semibold">{field.label}{field.required && <span className="text-destructive" aria-hidden="true">*</span>}{field.required && <span className="sr-only">(จำเป็น)</span>}</FieldLabel>
      {field.type === "textarea" ? <Textarea id={id} name={name} required={field.required} maxLength={answerMaxLength(field.type)} rows={3} className="min-h-24 rounded-lg bg-card px-3.5 py-3 text-base md:text-base" onChange={(event) => setAnswer(event.target.value)} />
        : field.type === "select" ? <NativeSelect id={id} name={name} required={field.required} defaultValue="" className="h-12 bg-card px-3 text-base" onChange={(event) => setAnswer(event.target.value)}><option value="">เลือกคำตอบ</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</NativeSelect>
        : field.type === "radio" ? <div role="radiogroup" aria-label={field.label} aria-required={field.required} className="flex flex-col gap-2">{field.options?.map((option) => <label key={option} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3.5 text-base has-[:checked]:border-primary"><input type="radio" name={name} value={option} required={field.required} className="size-5 accent-primary" onChange={() => setAnswer(option)} />{option}</label>)}</div>
        : field.type === "checkbox" ? <div role="group" aria-label={field.label} className="flex flex-col gap-2">{field.options?.map((option) => <label key={option} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3.5 text-base has-[:checked]:border-primary"><input type="checkbox" name={name} value={option} className="size-5 accent-primary" onChange={(event) => setAnswers((current) => { const selected = Array.isArray(current[field.key]) ? current[field.key] as string[] : []; return { ...current, [field.key]: event.target.checked ? [...selected, option] : selected.filter((item) => item !== option) }; })} />{option}</label>)}{field.required && <FieldDescription>เลือกอย่างน้อยหนึ่งข้อ</FieldDescription>}</div>
        : field.type === "file" ? <PublicFileField id={id} name={name} required={field.required} acceptedFileTypes={field.acceptedFileTypes ?? []} maxFileSizeMb={field.maxFileSizeMb ?? 5} maxFiles={field.maxFiles ?? 1} />
        : <Input id={id} name={name} type={field.type} required={field.required} maxLength={answerMaxLength(field.type)} pattern={field.type === "tel" ? TEL_ANSWER_PATTERN : undefined} inputMode={field.type === "tel" ? "tel" : undefined} placeholder={field.type === "tel" ? "เช่น 081-234-5678" : undefined} className={controlClass} onChange={(event) => setAnswer(event.target.value)} />}
    </Field>;
  }

  function parentAnswer(parentKey: string, field: RegistrationFieldConfig) {
    const answer = answers[parentKey];
    const wanted = field.conditional ? (Array.isArray(field.conditional.value) ? field.conditional.value : [field.conditional.value]) : [];
    return Array.isArray(answer) ? answer.filter((item) => wanted.includes(item)).join(", ") : answer ?? "";
  }

  return (
    <form ref={form} action={registerPublicEvent.bind(null, slug)} noValidate onSubmit={handleSubmit} className="flex flex-1 flex-col">
      <input type="hidden" name="formTicket" value={formTicket} />
      <input type="hidden" name="fieldsVersion" value={fieldsVersion} />
      <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden"><label htmlFor="public-website">เว็บไซต์</label><input id="public-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" /></div>
      {step === 1 && cover}
      <header className="flex flex-col gap-3 border-b bg-card px-5 pt-5 pb-4">
        <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">โครงการอบรม</p><Badge variant="secondary" className="rounded-md bg-muted font-semibold">{typeLabel}</Badge></div>
        <h1 className={cn("font-heading font-bold leading-snug", step === 1 ? "text-xl" : "text-lg")}>{title}</h1>
        {step === 1 && details}
        <div className="flex gap-1.5" role="progressbar" aria-label="ขั้นตอนลงทะเบียน" aria-valuemin={1} aria-valuemax={lastStep} aria-valuenow={step}>{Array.from({ length: lastStep }, (_, index) => index + 1).map((number) => <span key={number} className={cn("h-1 flex-1 rounded-full", number <= step ? "bg-primary" : "bg-border")} />)}</div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]"><strong className="font-semibold">ขั้นที่ {step}/{lastStep} · {stepTitle}</strong><span className="text-muted-foreground">ปิดรับ {deadline}</span></div>
      </header>
      {notice && <p role="alert" className="mx-5 mt-5 rounded-lg border border-destructive bg-card p-4 text-sm text-destructive">{notice}</p>}

      <section className={cn("flex flex-col gap-3 px-5 py-5", seatMode === "whole_course" && "gap-3.5", step !== 1 && "hidden")} aria-label={seatMode === "whole_course" ? "รายละเอียดหลักสูตร" : "เลือกวันที่เข้าร่วม"}>
        {seatMode === "whole_course" ? <CourseOverview days={days} remaining={courseRemaining} maxSeats={courseMaxSeats} waitlistEnabled={waitlistEnabled} /> : <>
        <p className="text-sm text-muted-foreground">เลือกได้หลายวัน อย่างน้อย 1 วัน · ที่นั่งนับแยกแต่ละวัน</p>
        <fieldset className="flex flex-col gap-3"><legend className="sr-only">วันที่เข้าร่วม</legend>
          {days.map((day, index) => {
            const date = utcDate(day.date);
            const selected = selectedDays.includes(day.id);
            const full = day.remaining === 0;
            const unavailable = day.isClosed || (full && !waitlistEnabled);
            return <label key={day.id} className={cn("flex items-center gap-4 rounded-xl border bg-card p-4 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50", unavailable ? "cursor-not-allowed opacity-60" : "cursor-pointer", full && !selected && "bg-muted", selected && "border-primary bg-primary text-primary-foreground")}>
              <input type="checkbox" name="dayId" value={day.id} checked={selected} disabled={unavailable} onChange={(event) => { setSelectedDays((current) => event.target.checked ? [...current, day.id] : current.filter((id) => id !== day.id)); setWizardError(""); }} className="sr-only" />
              <span className={cn("flex w-14 shrink-0 flex-col items-center rounded-lg bg-secondary px-1 py-2 text-xs", selected && "bg-primary-foreground/15 text-primary-foreground")}><span>{weekdayCard[date.getUTCDay()]}</span><strong className="font-heading text-2xl leading-tight">{date.getUTCDate()}</strong><span>{monthsShort[date.getUTCMonth()]}</span></span>
              <span className="flex min-w-0 flex-1 flex-col gap-1"><strong>วันที่ {index + 1}</strong><span className="text-xs">{day.isClosed ? "ปิดรับลงทะเบียนวันนี้" : day.remaining === null ? "ไม่จำกัดที่นั่ง" : full ? waitlistEnabled ? "เต็ม · เลือกได้เพื่อเข้าคิวสำรอง" : "เต็มแล้ว · ไม่รับสมัครเพิ่ม" : `เหลือ ${day.remaining} จาก ${day.maxSeats} ที่นั่ง`}</span></span>
              {day.isClosed ? <Badge variant="secondary">ปิดรับ</Badge> : selected ? <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-foreground text-primary"><CheckIcon className="size-4" aria-hidden="true" /></span> : full ? <Badge variant="destructive">เต็ม</Badge> : <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-2 border-input" />}
            </label>;
          })}
        </fieldset>
        </>}
      </section>

      {/* Every page stays mounted (hidden when not current) so its inputs keep their values and are all submitted. */}
      {formPages.map((page, pageIndex) => <section key={page.id} data-form-page={pageIndex} className={cn("flex flex-col gap-4 px-5 py-5", step !== pageIndex + 2 && "hidden")} aria-label={page.title}>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-accent px-3.5 py-3 text-sm font-semibold text-accent-foreground">
          <span className="min-w-0">{seatMode === "whole_course" ? `สมัครเข้าร่วมหลักสูตรครบ ${days.length} วัน` : chosenDays.map((day) => `วันที่ ${day.number} · ${shortDate(day.date)}`).join(", ")}</span>
          <button type="button" onClick={() => goTo(1)} className="shrink-0 rounded-sm text-[13px] underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">{seatMode === "whole_course" ? "ดูวันอบรม" : "แก้ไขวัน"}</button>
        </div>
        {groupByParent(page.fields).map((group) => group.parent
          ? <div key={`group-${group.fields[0].key}`} className="flex flex-col gap-3.5 rounded-xl bg-accent p-3.5">
              <p className="flex items-center gap-2 text-xs font-bold text-accent-foreground"><CheckIcon className="size-3.5" strokeWidth={3} aria-hidden="true" />ฟิลด์เพิ่มเติมสำหรับ “{parentAnswer(group.parent, group.fields[0])}”</p>
              {group.fields.map(renderField)}
            </div>
          : group.fields.map(renderField))}
      </section>)}

      <section className={cn("flex flex-col gap-3 px-5 py-5", step !== lastStep && "hidden")} aria-label="ยืนยันการลงทะเบียน">
        {lineEnabled && <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 font-semibold">รับ QR และผลการลงทะเบียนทาง <span className="text-destructive" aria-hidden="true">*</span></legend>
          <div className="grid grid-cols-2 gap-3">
            {([["EMAIL", "อีเมล", MailIcon, "ส่งบัตรพร้อม QR ไปที่อีเมล"], ["LINE", "LINE", MessageCircleIcon, "ส่งผลและลิงก์ QR ทาง LINE"]] as const).map(([value, label, Icon, hint]) => <label key={value} className="flex cursor-pointer flex-col gap-1.5 rounded-xl border bg-card p-4 has-checked:border-2 has-checked:border-primary has-checked:bg-accent">
              <span className="flex items-center gap-2.5 font-semibold"><input type="radio" name="notifyVia" value={value} checked={channel === value} onChange={() => setChannel(value)} className="size-4 accent-primary" /><Icon className={cn("size-4", value === "LINE" ? "text-[#06C755]" : "text-primary")} aria-hidden="true" />{label}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>
            </label>)}
          </div>
          {channel === "LINE" && <p className="rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">ไม่ต้องกรอกอีเมล — กดยืนยันแล้วจะเปิดหน้าสถานะของคุณ จากนั้นกด “เชื่อม LINE” เพื่อเข้าสู่ระบบ LINE และ<strong className="text-foreground">เพิ่ม OA ของระบบเป็นเพื่อน</strong> (ส่งข้อความได้เฉพาะเพื่อน) ถ้าเชื่อมไม่สำเร็จ เชื่อมใหม่หรือเปลี่ยนเป็นอีเมลได้ที่หน้าสถานะ</p>}
        </fieldset>}
        {channel === "EMAIL" && <div className="flex flex-col gap-3 rounded-xl border-2 border-primary bg-card p-4">
          <div className="flex items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"><MailIcon className="size-5" aria-hidden="true" /></span><div className="flex flex-col"><label htmlFor="public-email" className="font-semibold">อีเมล <span className="text-destructive" aria-hidden="true">*</span></label><span className="text-xs text-muted-foreground">ใช้ระบุตัวตนและรับบัตร QR</span></div></div>
          <Input ref={emailInput} id="public-email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="name@example.com" maxLength={191} required className={controlClass} />
        </div>}
        <p className="px-1 text-xs leading-relaxed text-muted-foreground">หลังส่งใบสมัคร ระบบจะแสดงหน้าสถานะ บันทึกลิงก์หน้านั้นไว้เพื่อดูผลและ QR ได้ทุกเมื่อ</p>
        <div className="flex items-start gap-3 rounded-xl border bg-card p-4 has-[:checked]:border-primary"><input ref={consentInput} id="public-consent" name="consent" type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" required /><label htmlFor="public-consent" className="text-sm leading-relaxed">{CURRENT_CONSENT_TEXT} <span className="text-destructive" aria-hidden="true">*</span></label></div>
      </section>

      {wizardError && <p role="alert" className="px-5 pb-4 text-sm text-destructive">{wizardError}</p>}
      <footer className="sticky bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))] mt-auto flex flex-col gap-2 border-t bg-card px-5 pt-3.5 pb-5">
        <div className="flex items-center gap-3">
          {/* Distinct keys: reusing one DOM button would flip it to type=submit mid-click and submit step 3 immediately. */}
          {step > 2 && <Button type="button" variant="outline" className="h-13 px-4" onClick={() => goTo(step - 1)}>ย้อนกลับ</Button>}
          {step < lastStep ? <Button key="next" type="button" disabled={step === 1 && courseFull} className="h-13 min-w-0 flex-1 text-base font-bold" onClick={nextStep}><span className="truncate">{step === 1 ? seatMode === "whole_course" ? "ถัดไป · กรอกข้อมูล" : `ถัดไป · เลือกแล้ว ${selectedDays.length} วัน` : step === lastStep - 1 ? "ถัดไป · ยืนยันข้อมูล" : `ถัดไป · ${formPages[step - 1].title}`}</span></Button> : <Button key="submit" type="submit" className="h-13 flex-1 text-base font-bold">ยืนยันการลงทะเบียน</Button>}
        </div>
        {step === 1 && seatMode === "whole_course" && <p className="text-center text-xs text-muted-foreground">ไม่ต้องเลือกวัน ระบบลงให้ครบทั้ง {days.length} วัน</p>}
        {step === lastStep && <p className="text-center text-xs text-muted-foreground">{autoApprove ? "ได้ QR ทันทีหลังยืนยัน (ถ้ายังมีที่นั่ง)" : "โครงการนี้อนุมัติเอง — จะได้ QR เมื่อผู้จัดอนุมัติ"}</p>}
      </footer>
    </form>
  );
}
