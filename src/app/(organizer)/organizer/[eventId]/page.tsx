import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CalendarDaysIcon, ChevronLeftIcon, ClipboardListIcon, ListChecksIcon, QrCodeIcon, UsersIcon } from "lucide-react";

import { updateEvent } from "@/app/(organizer)/organizer/actions";
import { SeatModeFields } from "@/app/(organizer)/organizer/seat-mode-fields";
import { addEventDays, removeEventDay, updateEventDay } from "@/app/(organizer)/organizer/schedule-actions";
import { EventDayCalendar } from "@/app/(organizer)/organizer/[eventId]/event-day-calendar";
import { PublishStep, type PublishCheck } from "@/app/(organizer)/organizer/[eventId]/publish-step";
import { SessionsPlanner, type PlannerSession } from "@/app/(organizer)/organizer/[eventId]/sessions-planner";
import { FieldBuilder } from "@/app/(organizer)/organizer/[eventId]/field-builder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { readRegistrationFields, validateRegistrationFields } from "@/features/events/registration-fields";
import { cn } from "@/lib/utils";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "ข้อมูลโครงการ" };

const statusLabel = {
  DRAFT: "ฉบับร่าง",
  PUBLISHED: "เผยแพร่แล้ว",
  CLOSED: "ปิดรับแล้ว",
} as const;

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const errorMessage: Record<string, string> = {
  "invalid-cover": "รูปปกไม่ถูกต้อง: ใช้ JPG, PNG หรือ WebP ที่มีขนาดไม่เกิน 3 MB",
  invalid: "กรุณาตรวจสอบข้อมูลโครงการอีกครั้ง",
  "invalid-day": "กรุณาเลือกวันที่และจำนวนที่นั่งให้ถูกต้อง",
  "duplicate-day": "วันที่นี้อยู่ในโครงการแล้ว",
  "day-in-use": "ลบวันไม่ได้: วันสุดท้ายของหลักสูตร หรือมีประวัติเช็คชื่อแล้ว (โหมดแยกรายวันต้องไม่มีผู้ลงทะเบียนหรือรอบเช็คชื่อ)",
  "invalid-session": "กรุณากรอกชื่อรอบเช็คชื่อให้ถูกต้อง",
  "session-in-use": "ลบรอบไม่ได้: รอบนี้มีประวัติเช็คชื่อ ต้องติ๊กยืนยันว่าจะลบประวัติเช็คชื่อของรอบนี้ด้วย",
  "duplicate-session": "ชื่อรอบซ้ำ: วันเดียวกันใช้ชื่อรอบซ้ำไม่ได้ และรอบที่ใช้ได้ทุกวันต้องไม่ซ้ำกับรอบอื่น",
  "invalid-field": "บันทึกฟิลด์ไม่ได้: ตรวจชื่อฟิลด์ เงื่อนไข (ฟิลด์ลูกต้องอยู่หลังฟิลด์แม่ และใช้ค่าที่มีในตัวเลือกของฟิลด์แม่) และตัวเลือกที่ฟิลด์ลูกอ้างถึง",
  "invalid-condition": "ตั้งเงื่อนไขไม่ครบ: เลือกค่าของฟิลด์แม่อย่างน้อย 1 ค่า หรือปิดสวิตช์ “แสดงแบบมีเงื่อนไข”",
  "invalid-options": "ตัวเลือกต้องมี 2–30 ค่า ห้ามซ้ำกัน และยาวไม่เกิน 191 ตัวอักษร",
  "fields-locked": "แก้ฟอร์มได้เฉพาะโครงการฉบับร่าง",
  "field-in-use": "ลบฟิลด์นี้ไม่ได้ เพราะมีผู้ลงทะเบียนหรือฟิลด์อื่นอ้างถึงอยู่",
};

const wizardSteps = [
  { label: "ข้อมูลโครงการ", icon: ClipboardListIcon },
  { label: "วันที่จัด & ที่นั่ง", icon: CalendarDaysIcon },
  { label: "ฟอร์มลงทะเบียน", icon: ListChecksIcon },
  { label: "รอบเช็คชื่อ", icon: QrCodeIcon },
  { label: "ผู้ร่วมจัด & เผยแพร่", icon: UsersIcon },
];

const dayTitle = new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayShort = new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const deadlineLabel = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
const sessionMessages: Record<string, string> = {
  "invalid-session": "กรุณากรอกชื่อรอบและเลือกวันให้ถูกต้อง",
  "invalid-session-time": "เวลาสิ้นสุดต้องหลังเวลาเริ่ม",
  "duplicate-session": "ชื่อรอบซ้ำ: วันเดียวกันใช้ชื่อซ้ำไม่ได้ และรอบที่ใช้ได้ทุกวันต้องไม่ซ้ำกับรอบอื่น",
  "session-in-use": "รอบนี้มีประวัติเช็คชื่อ ต้องติ๊กยืนยันก่อนลบ",
  "session-day-locked": "รอบที่มีการเช็คชื่อแล้วย้ายวันไม่ได้",
  "preset-exists": "ทุกวันมีรอบชื่อนี้อยู่แล้ว ไม่ได้เพิ่มรอบใหม่",
};

function toPlanner(session: { id: string; label: string; startTime: Date | null; endTime: Date | null; _count: { checkIns: number } }, dayId: string | null): PlannerSession {
  return { id: session.id, label: session.label, start: session.startTime ? clock.format(session.startTime) : "", end: session.endTime ? clock.format(session.endTime) : "", checkIns: session._count.checkIns, dayId };
}

export default async function EventPage({ params, searchParams }: PageProps<"/organizer/[eventId]">) {
  const { eventId } = await params;
  const { event, user } = await requireEventAccess(eventId, "manage");
  const { error, saved, step: requestedStep, field: selectedField, session: selectedSession, added } = await searchParams;
  const registrantCount = await db.registrant.count({ where: { eventId } });
  const step = typeof requestedStep === "string" && /^[1-5]$/.test(requestedStep)
    ? Number(requestedStep)
    : saved === "field" || ["invalid-field", "invalid-condition", "invalid-options", "fields-locked", "field-in-use"].includes(String(error)) ? 3
    : saved === "session" || ["invalid-session", "session-in-use", "duplicate-session"].includes(String(error)) ? 4
    : saved === "member" || saved === "status" || ["invalid-member", "member-not-found", "not-ready", "invalid-status"].includes(String(error)) ? 5
    : saved === "day" || ["invalid-day", "duplicate-day", "day-in-use"].includes(String(error)) ? 2
    : 1;
  const save = updateEvent.bind(null, eventId);
  const addDay = addEventDays.bind(null, eventId);
  const registrationFields = readRegistrationFields(event.fields);
  const canAdminister = event.ownerId === user.id || user.role === "ADMIN";
  const [members, owner] = await Promise.all([
    db.eventOrganizer.findMany({ where: { eventId }, orderBy: { addedAt: "asc" }, include: { user: { select: { name: true, email: true } } } }),
    db.user.findUniqueOrThrow({ where: { id: event.ownerId }, select: { name: true, email: true } }),
  ]);
  const days = await db.eventDay.findMany({
    where: { eventId },
    orderBy: { date: "asc" },
    include: {
      _count: { select: { registrantDays: true } },
      sessions: {
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        include: { _count: { select: { checkIns: { where: { voidedAt: null } } } } },
      },
    },
  });
  const approvedByDay = days.length ? await db.registrantEventDay.groupBy({
    by: ["eventDayId"],
    where: { eventDayId: { in: days.map((day) => day.id) }, status: "APPROVED" },
    _count: { _all: true },
  }) : [];
  const approvedCountByDay = new Map(approvedByDay.map((day) => [day.eventDayId, day._count._all]));
  const hasRegistrationFields = registrationFields.length > 0;
  const hasValidRegistrationFields = hasRegistrationFields && validateRegistrationFields(registrationFields);
  const globalSessions = step === 4 || step === 5 ? await db.session.findMany({ where: { eventId, eventDayId: null }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], include: { _count: { select: { checkIns: { where: { voidedAt: null } } } } } }) : [];
  const hasSessions = days.length > 0 && (globalSessions.length > 0 || days.every((day) => day.sessions.length > 0));
  const hasFutureDeadline = !!event.registrationDeadline && event.registrationDeadline > new Date();
  const hasFileFields = registrationFields.some((field) => field.type === "file");
  const hasFileStorage = process.env.NODE_ENV !== "production" || !hasFileFields;
  const hasProductionTurnstile = process.env.NODE_ENV !== "production" || !!(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
  const sessionCount = days.reduce((sum, day) => sum + day.sessions.length, 0) + globalSessions.length;
  const publishChecks: PublishCheck[] = [
    { label: "ข้อมูลโครงการ + ประเภท", ready: !!event.title.trim(), step: 1 },
    { label: days.length ? `วันที่จัด ${days.length} วัน${event.seatMode === "whole_course" ? ` · ที่นั่ง ${event.maxSeats?.toLocaleString("th-TH") ?? "ไม่จำกัด"}` : " · ที่นั่งครบ"}` : "วันที่จัด", detail: days.length ? undefined : "ยังไม่ได้เลือกวันจัด", ready: days.length > 0, step: 2 },
    { label: `ฟอร์ม ${registrationFields.length} ฟิลด์`, detail: hasValidRegistrationFields ? undefined : "ต้องมีอย่างน้อย 1 ฟิลด์และตั้งค่าถูกต้อง", ready: hasValidRegistrationFields, step: 3 },
    { label: `รอบเช็คชื่อ ${sessionCount} รอบ`, detail: hasSessions ? undefined : "ทุกวันต้องมีรอบ หรือมีรอบที่ใช้ได้ทุกวัน", ready: hasSessions, step: 4 },
    { label: event.registrationDeadline ? `ปิดรับ ${deadlineLabel.format(event.registrationDeadline)}` : "วันปิดรับลงทะเบียน", detail: hasFutureDeadline ? undefined : "ต้องตั้งวันปิดรับที่ยังไม่ผ่านมา", ready: hasFutureDeadline, step: 1 },
    ...(hasFileFields ? [{ label: "ที่เก็บไฟล์แนบ", detail: process.env.NODE_ENV !== "production" ? "ใช้ local private storage (development)" : hasFileStorage ? undefined : "production ต้องตั้งค่า private object storage", ready: hasFileStorage }] : []),
    ...(!hasProductionTurnstile ? [{ label: "Cloudflare Turnstile", detail: "production ต้องตั้งค่า Turnstile ก่อนเปิดรับสมัคร", ready: false }] : []),
  ];
  const stepReady = [!!event.title.trim() && hasFutureDeadline, days.length > 0, hasValidRegistrationFields, hasSessions, event.status !== "DRAFT"];
  const deadlineDate = event.registrationDeadline
    ? new Date(event.registrationDeadline.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : "";
  const todayInBangkok = new Date(new Date().getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-5 border-b bg-card px-4 py-5 sm:px-6 lg:min-h-[calc(100svh-60px)] lg:w-[300px] lg:gap-6 lg:border-b-0 lg:border-r lg:px-8 lg:py-9">
        <div className="flex flex-col gap-1">
          <Link href="/organizer" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeftIcon className="size-4" aria-hidden="true" />โครงการของฉัน</Link>
          <h2 className="font-heading text-xl font-bold leading-snug">{event.title}</h2>
          <span className="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="secondary" className={event.status === "PUBLISHED" ? "bg-accent text-accent-foreground" : event.status === "DRAFT" ? "bg-amber-100 text-amber-900" : ""}>{statusLabel[event.status]}</Badge>ตั้งค่าโครงการ</span>
        </div>
        <nav aria-label="ขั้นตอนตั้งค่าโครงการ" className="grid grid-cols-5 gap-1 lg:flex lg:flex-col lg:gap-0">
          {wizardSteps.map(({ label }, index) => {
            const current = step === index + 1;
            // A step is ticked only when its data is actually ready, not merely visited.
            const complete = !current && stepReady[index];
            return <Link key={label} href={`/organizer/${eventId}?step=${index + 1}`} aria-current={current ? "step" : undefined}
              className={cn("relative flex min-w-0 flex-col items-center gap-2 rounded-lg px-1 py-2 text-center transition-colors hover:bg-muted lg:min-h-[68px] lg:flex-row lg:items-center lg:gap-3 lg:px-2 lg:py-2 lg:text-left", current && "bg-accent lg:bg-transparent")}>
              <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-card text-sm font-semibold", current && "border-primary bg-primary text-primary-foreground", complete && "border-primary bg-primary text-primary-foreground", !current && !complete && "border-input text-muted-foreground")}>
                {complete ? "✓" : index + 1}
              </span>
              <span className="flex min-w-0 flex-col lg:gap-0.5">
                <span className="hidden text-xs text-muted-foreground lg:block">ขั้นที่ {index + 1}</span>
                <span className={cn("line-clamp-2 text-[10px] font-medium leading-tight sm:text-xs lg:text-sm", current ? "text-foreground" : "text-muted-foreground")}>{label}</span>
              </span>
              {index < wizardSteps.length - 1 && <span aria-hidden="true" className="absolute left-[calc(50%+16px)] top-[26px] hidden h-0.5 w-[calc(100%-28px)] bg-border lg:left-[15px] lg:top-[50px] lg:block lg:h-9 lg:w-0.5" />}
            </Link>;
          })}
        </nav>
        <p className="hidden rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground lg:mt-auto lg:block">บันทึกแต่ละส่วนก่อนเปลี่ยนขั้น · เผยแพร่ได้เมื่อข้อมูลครบ</p>
      </aside>
    <div className="flex min-w-0 flex-1 flex-col">
    <main className="flex w-full max-w-[1320px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:gap-7 lg:px-12 lg:py-9">
      {step === 1 && <>
      <form action={save} encType="multipart/form-data" className="flex flex-col gap-6 rounded-xl border bg-card p-6">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="title">ชื่อโครงการ</FieldLabel>
            <Input id="title" name="title" defaultValue={event.title} maxLength={191} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="description">รายละเอียด</FieldLabel>
            <Textarea id="description" name="description" defaultValue={event.description ?? ""} maxLength={10000} rows={4} />
          </Field>
          <Field>
            <FieldLabel htmlFor="location">สถานที่</FieldLabel>
            <Input id="location" name="location" defaultValue={event.location ?? ""} maxLength={191} />
          </Field>
          <Field>
            <FieldLabel htmlFor="eventType">ประเภทโครงการ</FieldLabel>
            <NativeSelect id="eventType" name="eventType" defaultValue={event.eventType} required>
              <option value="INTERNAL">ภายใน</option>
              <option value="EXTERNAL">ภายนอก</option>
              <option value="MIXED">ผสม</option>
            </NativeSelect>
            {registrantCount > 0 && <FieldDescription>มีผู้ลงทะเบียนแล้ว {registrantCount.toLocaleString("th-TH")} คน การเปลี่ยนประเภทโครงการไม่กระทบผู้ที่ลงทะเบียนไปแล้ว</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel htmlFor="deadlineDate">วันปิดรับลงทะเบียน</FieldLabel>
            <Input id="deadlineDate" name="deadlineDate" type="date" defaultValue={deadlineDate} />
            <FieldDescription>ปิดรับเวลา 23:59 น. ตามเวลาไทยในวันที่เลือก</FieldDescription>
          </Field>
          <SeatModeFields initialMode={event.seatMode} maxSeats={event.maxSeats} attendanceThreshold={event.attendanceThreshold} locked={event.status !== "DRAFT"} />
        </FieldGroup>
        <div className="flex flex-col gap-5">
          <Field className="rounded-xl border p-4 sm:p-5">
            <FieldLabel htmlFor="coverImage">รูปปก (JPG, PNG, WebP ไม่เกิน 3 MB)</FieldLabel>
            {event.coverImageUrl && <Image src={event.coverImageUrl} alt="รูปปกโครงการปัจจุบัน" width={640} height={360} unoptimized className="mb-2 aspect-video w-full rounded-lg object-cover" />}
            <Input id="coverImage" name="coverImage" type="file" accept="image/jpeg,image/png,image/webp" />
            <FieldDescription>เก็บแบบ local ใน development; production ต้องใช้ private object storage</FieldDescription>
            {event.coverImageKey && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="removeCover" className="size-4 accent-primary" />ลบรูปปกปัจจุบัน</label>}
          </Field>
          <Field orientation="horizontal" className="rounded-xl border p-4 sm:p-5">
            <input id="autoApprove" name="autoApprove" type="checkbox" defaultChecked={event.autoApprove} className="size-4 accent-primary" />
            <FieldLabel htmlFor="autoApprove">อนุมัติผู้ลงทะเบียนอัตโนมัติ</FieldLabel>
          </Field>
          <Field><FieldLabel htmlFor="pendingHoldHours">เวลาจองที่นั่งระหว่างรออนุมัติ</FieldLabel><Input id="pendingHoldHours" name="pendingHoldHours" type="number" min={1} max={720} defaultValue={event.pendingHoldHours ?? ""} placeholder="ไม่หมดอายุ" /><FieldDescription>ระบุจำนวนชั่วโมง หรือเว้นว่างไว้</FieldDescription></Field>
          <Field><FieldLabel htmlFor="retentionDays">ระยะเก็บข้อมูลส่วนบุคคล (วัน)</FieldLabel><Input id="retentionDays" name="retentionDays" type="number" min={30} max={3650} defaultValue={event.retentionDays} disabled={!!event.anonymizedAt} /><FieldDescription>{event.anonymizedAt ? "ข้อมูลส่วนบุคคลของโครงการนี้ถูกปกปิดแล้ว เหลือเฉพาะสถิติ" : "นับหลังวันจัดสุดท้าย เมื่อครบกำหนดระบบจะลบข้อมูลที่ระบุตัวตนและไฟล์แนบ เหลือเฉพาะสถิติ"}</FieldDescription></Field>
          <Field><FieldLabel htmlFor="waitlistPromotion">เลื่อนคิวเมื่อมีที่นั่งว่าง</FieldLabel><NativeSelect id="waitlistPromotion" name="waitlistPromotion" defaultValue={event.waitlistPromotion}><option value="MANUAL">ให้ผู้จัดเลือกเอง</option><option value="AUTO">อัตโนมัติ ตามลำดับคิว</option></NativeSelect></Field>
        </div>
        </div>
        {error === "invalid" && <p role="alert" className="text-sm text-destructive">{errorMessage.invalid}</p>}
        <div className="flex justify-end">
          <Button type="submit">บันทึกข้อมูล</Button>
        </div>
      </form>
      </>}

      {step === 3 && <section className="flex flex-col gap-7">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-[22px] font-bold">ฟอร์มลงทะเบียน</h2>
          <p className="text-sm text-muted-foreground">ลากเรียงลำดับได้ · ฟิลด์ลูกจะโผล่เฉพาะเมื่อฟิลด์แม่ถูกเลือกตามเงื่อนไข</p>
        </div>
        <FieldBuilder key={registrationFields.map((field) => field.key).join(",")} eventId={eventId} fields={registrationFields} editable={event.status === "DRAFT" && registrantCount === 0} initialSelected={typeof selectedField === "string" ? selectedField : undefined} error={typeof error === "string" ? errorMessage[error] : undefined} />
      </section>}

      {step === 2 && <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-2xl font-bold">วันที่จัดอบรม & ที่นั่ง</h2>
          <p className="text-sm text-muted-foreground">คลิกเลือกหลายวันในปฏิทินได้ ไม่จำเป็นต้องต่อเนื่อง กำหนดที่นั่งเริ่มต้นพร้อมกันแล้วแก้แยกแต่ละวันได้</p>
        </div>
        <div className={cn("grid items-start gap-6", step === 2 && "xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]")}>
        {step === 2 && <EventDayCalendar action={addDay} selectedDays={days.map((day) => day.date.toISOString().slice(0, 10))} today={todayInBangkok} seatMode={event.seatMode} />}
        <div className="flex flex-col gap-4">
        {step === 2 && <div className="flex items-center justify-between rounded-xl border bg-card px-5 py-4"><h3 className="font-heading text-lg font-bold">เลือกแล้ว {days.length} วัน</h3><span className="text-sm text-muted-foreground">{event.seatMode === "whole_course" ? `ที่นั่งทั้งหลักสูตร ${event.maxSeats?.toLocaleString("th-TH") ?? "ไม่จำกัด"}` : `ที่นั่งรวม ${days.reduce((sum, day) => sum + (day.maxSeats ?? 0), 0).toLocaleString("th-TH")}${days.some((day) => day.maxSeats === null) ? " + ไม่จำกัด" : ""}`}</span></div>}
        {days.length === 0 && <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">ยังไม่มีวันที่จัด เพิ่มอย่างน้อย 1 วันก่อนเผยแพร่โครงการ</p>}

        {days.map((day, index) => (
          <section key={day.id} id={`day-${day.date.toISOString().slice(0, 10)}`} className="flex flex-col gap-4 rounded-xl border bg-card p-6">
            {step === 2 && <form action={updateEventDay.bind(null, eventId, day.id)} className="flex flex-wrap items-end gap-2">
              <Field className="max-w-48"><FieldLabel htmlFor={`day-date-${day.id}`}>แก้วันที่จัด</FieldLabel><Input id={`day-date-${day.id}`} name="date" type="date" defaultValue={day.date.toISOString().slice(0, 10)} required /></Field>
              <Field className={event.seatMode === "whole_course" ? "hidden" : "max-w-36"}><FieldLabel htmlFor={`day-seats-${day.id}`}>ที่นั่ง</FieldLabel><Input id={`day-seats-${day.id}`} name="maxSeats" type="number" min={1} defaultValue={day.maxSeats ?? ""} disabled={event.seatMode === "whole_course"} placeholder="ไม่จำกัด" /><FieldDescription>เว้นว่างไว้เพื่อไม่จำกัด</FieldDescription></Field>
               {event.seatMode === "per_day" && <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="isClosed" defaultChecked={day.isClosed} className="size-4 accent-primary" />ปิดรับวันนี้</label>}
              <Button type="submit" variant="outline">บันทึก</Button>
            </form>}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <Badge variant={day.isClosed ? "destructive" : "secondary"} className="w-fit">วันที่ {index + 1}{day.isClosed ? " · ปิดรับ" : ""}</Badge>
                <h3 className="font-heading text-lg font-semibold">{dateFormatter.format(day.date)}</h3>
                 <p className="text-sm text-muted-foreground">{event.seatMode === "whole_course" ? `ผู้สมัครที่ผูกกับวันนี้ ${day._count.registrantDays} คน` : `อนุมัติแล้ว ${approvedCountByDay.get(day.id) ?? 0} / ${day.maxSeats?.toLocaleString("th-TH") ?? "ไม่จำกัด"} ที่นั่ง · ${day._count.registrantDays} คนเลือกวันนี้`}</p>
              </div>
              {step === 2 && (event.seatMode === "whole_course" ? days.length > 1 : day._count.registrantDays === 0 && day.sessions.length === 0) && (
                <form action={removeEventDay.bind(null, eventId, day.id)} className="flex flex-col items-end gap-2">
                  {event.seatMode === "whole_course" && <label className="max-w-72 text-right text-xs text-muted-foreground"><input type="checkbox" name="confirm" required className="mr-1" />ยืนยันลบวันนี้จากผู้สมัครทุกคนและลบรอบเช็คชื่อของวันนี้ · แจ้งผู้เข้าอบรมหลังบันทึก</label>}
                  <Button type="submit" variant="destructive" size="sm">ลบวัน</Button>
                </form>
              )}
            </div>
            {step === 2 && day.maxSeats && <div className="flex flex-col gap-2" aria-label={`ที่นั่งอนุมัติแล้ว ${approvedCountByDay.get(day.id) ?? 0} จาก ${day.maxSeats}`}><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (approvedCountByDay.get(day.id) ?? 0) / day.maxSeats * 100)}%` }} /></div><p className="text-xs text-muted-foreground">เหลือ {Math.max(0, day.maxSeats - (approvedCountByDay.get(day.id) ?? 0)).toLocaleString("th-TH")} ที่นั่ง</p></div>}
          </section>
        ))}
        </div>
        </div>
      </section>}

      {step === 4 && <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-[22px] font-bold">รอบเช็คชื่อ</h2>
          <p className="text-sm text-muted-foreground">อย่างน้อย 1 รอบต่อโครงการ · ผูกรอบกับวันจัดได้ เพื่อให้หน้างานเตือนเมื่อคนสแกนไม่ได้ลงวันนั้นไว้</p>
        </div>
        <SessionsPlanner
          eventId={eventId}
          initialSession={typeof selectedSession === "string" ? selectedSession : undefined}
          notice={typeof error === "string" && sessionMessages[error] ? { text: sessionMessages[error], tone: "error" } : saved === "session" ? { text: typeof added === "string" ? `เพิ่มรอบแล้ว ${added} รอบ` : "บันทึกรอบแล้ว", tone: "ok" } : undefined}
          days={days.map((day, index) => ({
            id: day.id, number: index + 1, title: dayTitle.format(day.date), shortTitle: dayShort.format(day.date),
            seats: event.seatMode === "whole_course" ? null : `${(approvedCountByDay.get(day.id) ?? 0).toLocaleString("th-TH")} / ${day.maxSeats?.toLocaleString("th-TH") ?? "ไม่จำกัด"} ที่นั่ง`,
            sessions: day.sessions.map((session) => toPlanner(session, day.id)),
          }))}
          everyDay={globalSessions.map((session) => toPlanner(session, null))}
        />
      </section>}

      {step !== 3 && step !== 4 && step !== 5 && typeof error === "string" && error !== "invalid" && errorMessage[error] && (
        <p role="alert" className="text-sm text-destructive">{errorMessage[error]}</p>
      )}
      {saved === "cloned" ? <p role="status" className="rounded-lg border border-primary/30 bg-accent px-4 py-3 text-sm text-accent-foreground">ทำสำเนาโครงการแล้ว — คัดลอกข้อมูล ฟอร์ม รูปปก และรอบเช็คชื่อ (แบบไม่ผูกวัน) มาให้ ต้องกำหนดวันที่จัด ที่นั่ง วันปิดรับ และผู้ร่วมจัดใหม่</p>
        : saved && step !== 4 && step !== 5 && <p role="status" className="text-sm text-muted-foreground">บันทึกข้อมูลแล้ว</p>}

      {step === 5 && <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-[22px] font-bold">ผู้ร่วมจัด & เผยแพร่</h2>
          <p className="text-sm text-muted-foreground">เจ้าของเท่านั้นที่เพิ่ม/ลบผู้ร่วมจัด และกดเผยแพร่/ปิดรับได้</p>
        </div>
        <PublishStep event={event} owner={owner} members={members} checks={publishChecks} canAdminister={canAdminister}
          error={typeof error === "string" ? error : undefined} saved={typeof saved === "string" ? saved : undefined} />
      </section>}
    </main>
    <footer className="sticky bottom-0 mt-auto flex flex-wrap items-center justify-between gap-3 border-t bg-card px-4 py-3 shadow-[0_-4px_16px_rgb(0_0_0/0.04)] sm:px-6 sm:py-4 lg:px-12">
      <Button asChild variant="outline" size="lg"><Link href={step > 1 ? `/organizer/${eventId}?step=${step - 1}` : "/organizer"}><ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />{step > 1 ? "ย้อนกลับ" : "โครงการของฉัน"}</Link></Button>
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:inline">ขั้นที่ {step} จาก 5</span>
        {step < 5 ? <Button asChild size="lg"><Link href={`/organizer/${eventId}?step=${step + 1}`}>ถัดไป: {wizardSteps[step].label}</Link></Button> : <Button asChild size="lg"><Link href={event.status === "DRAFT" ? "/organizer" : `/organizer/${eventId}/dashboard`}>เสร็จสิ้น</Link></Button>}
      </div>
    </footer>
    </div>
    </div>
  );
}
