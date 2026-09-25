import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CalendarDaysIcon, ClipboardListIcon, ListChecksIcon, QrCodeIcon, UsersIcon } from "lucide-react";

import { cloneEvent, updateEvent } from "@/app/(organizer)/organizer/actions";
import { deleteOwnedEvent } from "@/app/(organizer)/organizer/[eventId]/delete-action";
import { SeatModeFields } from "@/app/(organizer)/organizer/seat-mode-fields";
import { addRegistrationField } from "@/app/(organizer)/organizer/field-actions";
import { addEventDays, addSessionForScope, removeEventDay, removeSession, updateEventDay, updateSession } from "@/app/(organizer)/organizer/schedule-actions";
import { changeEventStatus } from "@/app/(organizer)/organizer/[eventId]/status-actions";
import { addEventMember, removeEventMember } from "@/app/(organizer)/organizer/[eventId]/member-actions";
import { EventDayCalendar } from "@/app/(organizer)/organizer/[eventId]/event-day-calendar";
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
  "invalid-field": "กรุณาตรวจสอบข้อมูลฟิลด์อีกครั้ง",
  "invalid-options": "ตัวเลือกต้องมี 2–30 ค่า ห้ามซ้ำกัน และยาวไม่เกิน 191 ตัวอักษร",
  "fields-locked": "แก้ฟอร์มได้เฉพาะโครงการฉบับร่าง",
  "field-in-use": "ลบฟิลด์นี้ไม่ได้ เพราะมีผู้ลงทะเบียนหรือฟิลด์อื่นอ้างถึงอยู่",
};

function RemoveSessionForm({ action, checkIns }: { action: (formData: FormData) => Promise<void>; checkIns: number }) {
  if (checkIns === 0) return <form action={action}><Button type="submit" variant="ghost" size="sm">ลบรอบ</Button></form>;
  return <details className="text-sm">
    <summary className="cursor-pointer text-destructive">ลบรอบ…</summary>
    <form action={action} className="mt-2 flex flex-col gap-2 rounded-lg border border-destructive/50 p-3">
      <label className="flex items-start gap-2"><input type="checkbox" name="confirmCheckIns" required className="mt-1 size-4 accent-destructive" />ยืนยันลบรอบนี้พร้อมประวัติเช็คชื่อ {checkIns.toLocaleString("th-TH")} รายการ (กู้คืนไม่ได้ และบันทึกใน audit log)</label>
      <Button type="submit" variant="destructive" size="sm" className="w-fit">ลบรอบและประวัติเช็คชื่อ</Button>
    </form>
  </details>;
}

const wizardSteps = [
  { label: "ข้อมูลโครงการ", icon: ClipboardListIcon },
  { label: "วันที่จัด & ที่นั่ง", icon: CalendarDaysIcon },
  { label: "ฟอร์มลงทะเบียน", icon: ListChecksIcon },
  { label: "รอบเช็คชื่อ", icon: QrCodeIcon },
  { label: "ผู้ร่วมจัด & เผยแพร่", icon: UsersIcon },
];

export default async function EventPage({ params, searchParams }: PageProps<"/organizer/[eventId]">) {
  const { eventId } = await params;
  const { event, user } = await requireEventAccess(eventId, "manage");
  const { error, saved, step: requestedStep } = await searchParams;
  const registrantCount = await db.registrant.count({ where: { eventId } });
  const step = typeof requestedStep === "string" && /^[1-5]$/.test(requestedStep)
    ? Number(requestedStep)
    : saved === "field" || ["invalid-field", "invalid-options", "fields-locked", "field-in-use"].includes(String(error)) ? 3
    : saved === "session" || ["invalid-session", "session-in-use", "duplicate-session"].includes(String(error)) ? 4
    : saved === "member" || saved === "status" || ["invalid-member", "member-not-found", "not-ready", "invalid-status"].includes(String(error)) ? 5
    : saved === "day" || ["invalid-day", "duplicate-day", "day-in-use"].includes(String(error)) ? 2
    : 1;
  const save = updateEvent.bind(null, eventId);
  const addDay = addEventDays.bind(null, eventId);
  const addField = addRegistrationField.bind(null, eventId);
  const registrationFields = readRegistrationFields(event.fields);
  const canAdminister = event.ownerId === user.id || user.role === "ADMIN";
  const members = canAdminister ? await db.eventOrganizer.findMany({ where: { eventId }, include: { user: { select: { name: true, email: true } } } }) : [];
  const days = await db.eventDay.findMany({
    where: { eventId },
    orderBy: { date: "asc" },
    include: {
      _count: { select: { registrantDays: true } },
      sessions: {
        orderBy: { label: "asc" },
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
  const globalSessions = step === 4 || step === 5 ? await db.session.findMany({ where: { eventId, eventDayId: null }, orderBy: { label: "asc" }, include: { _count: { select: { checkIns: { where: { voidedAt: null } } } } } }) : [];
  const hasSessions = days.length > 0 && (globalSessions.length > 0 || days.every((day) => day.sessions.length > 0));
  const hasFutureDeadline = !!event.registrationDeadline && event.registrationDeadline > new Date();
  const hasFileFields = registrationFields.some((field) => field.type === "file");
  const hasFileStorage = process.env.NODE_ENV !== "production" || !hasFileFields;
  const hasProductionTurnstile = process.env.NODE_ENV !== "production" || !!(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
  const publishChecks = [
    { label: "วันจัดอบรม", ready: days.length > 0 },
    { label: "รอบเช็คชื่อครบทุกวัน", ready: hasSessions },
    { label: "ฟอร์มลงทะเบียน", ready: hasValidRegistrationFields },
    { label: "วันปิดรับสมัครในอนาคต", ready: hasFutureDeadline },
    { label: "ที่เก็บไฟล์", ready: hasFileStorage, note: hasFileFields && process.env.NODE_ENV !== "production" ? "ใช้ local private storage" : undefined },
    { label: "Turnstile สำหรับ production", ready: hasProductionTurnstile },
  ];
  const readyToPublish = days.length > 0 && days.every((day) => globalSessions.length > 0 || day.sessions.length > 0)
    && hasValidRegistrationFields && hasFileStorage && hasProductionTurnstile && hasFutureDeadline;
  const deadlineDate = event.registrationDeadline
    ? new Date(event.registrationDeadline.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : "";
  const todayInBangkok = new Date(new Date().getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-5 border-b bg-card px-4 py-5 sm:px-6 lg:min-h-[calc(100svh-60px)] lg:w-[300px] lg:gap-6 lg:border-b-0 lg:border-r lg:px-8 lg:py-9">
        <div className="flex flex-col gap-1">
          <Link href="/organizer" className="text-xs text-muted-foreground hover:text-foreground">‹ โครงการของฉัน</Link>
          <h2 className="font-heading text-xl font-bold">ตั้งค่าโครงการ</h2>
        </div>
        <nav aria-label="ขั้นตอนตั้งค่าโครงการ" className="grid grid-cols-5 gap-1 lg:flex lg:flex-col lg:gap-0">
          {wizardSteps.map(({ label }, index) => {
            const current = step === index + 1;
            const complete = step > index + 1;
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
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1"><Link href="/organizer" className="text-xs text-muted-foreground hover:text-foreground">????????????? / {event.title}</Link><p className="text-xs text-muted-foreground">??????? {step} ??? 5</p></div>
        <Badge variant={event.status === "PUBLISHED" ? "default" : "secondary"}>{statusLabel[event.status]}</Badge>
      </div>
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
          <Field><FieldLabel htmlFor="waitlistPromotion">เลื่อนคิวเมื่อมีที่นั่งว่าง</FieldLabel><NativeSelect id="waitlistPromotion" name="waitlistPromotion" defaultValue={event.waitlistPromotion}><option value="MANUAL">ให้ผู้จัดเลือกเอง</option><option value="AUTO">อัตโนมัติ ตามลำดับคิว</option></NativeSelect></Field>
        </div>
        </div>
        {error === "invalid" && <p role="alert" className="text-sm text-destructive">{errorMessage.invalid}</p>}
        <div className="flex justify-end">
          <Button type="submit">บันทึกข้อมูล</Button>
        </div>
      </form>
      </>}

      {step === 3 && <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-2xl font-bold">ฟอร์มลงทะเบียน</h2>
          <p className="text-sm text-muted-foreground">ลากเรียงลำดับได้ · ฟิลด์แบบมีเงื่อนไขต้องอยู่หลังฟิลด์แม่ · โครงการที่เผยแพร่แล้วจะล็อกการแก้ฟอร์ม</p>
        </div>
        {registrationFields.length === 0 && <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">ยังไม่มีฟิลด์ลงทะเบียน</p>}
        {registrationFields.length > 0 && <FieldBuilder eventId={eventId} fields={registrationFields} editable={event.status === "DRAFT"} />}
        {event.status === "DRAFT" && (
          <form action={addField} className="flex flex-col gap-5 rounded-xl border bg-card p-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="fieldLabel">ชื่อฟิลด์</FieldLabel>
                <Input id="fieldLabel" name="label" maxLength={191} placeholder="เช่น ชื่อ-นามสกุล" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="fieldType">ชนิดข้อมูล</FieldLabel>
                <NativeSelect id="fieldType" name="type" defaultValue="text">
                  <option value="text">ข้อความสั้น</option>
                  <option value="textarea">ข้อความยาว</option>
                  <option value="email">อีเมล</option>
                  <option value="tel">เบอร์โทรศัพท์</option>
                  <option value="date">วันที่</option>
                  <option value="select">ตัวเลือก</option>
                  <option value="checkbox">ช่องทำเครื่องหมาย</option>
                  <option value="file">ไฟล์แนบ (local, สูงสุด 5 MB)</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="optionsText">ตัวเลือก / ชนิดไฟล์ที่อนุญาต</FieldLabel>
                <Textarea id="optionsText" name="optionsText" rows={3} maxLength={3000} placeholder="ตัวเลือกต่อบรรทัด หรือ pdf, jpg, png, webp สำหรับไฟล์" />
              </Field>
              <Field>
                <FieldLabel htmlFor="maxFileSizeMb">ขนาดไฟล์สูงสุด (ใช้กับชนิดไฟล์เท่านั้น, 1–5 MB)</FieldLabel>
                <Input id="maxFileSizeMb" name="maxFileSizeMb" type="number" min={1} max={5} defaultValue={5} />
              </Field>
              <Field>
                <FieldLabel htmlFor="conditionField">แสดงเมื่อฟิลด์ก่อนหน้ามีคำตอบ (ไม่บังคับ)</FieldLabel>
                <NativeSelect id="conditionField" name="conditionField" defaultValue="">
                  <option value="">แสดงเสมอ</option>
                  {registrationFields.filter((item) => item.type === "select" || item.type === "checkbox").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </NativeSelect>
              </Field>
              <Field><FieldLabel htmlFor="conditionValue">ค่าเงื่อนไขที่ต้องตรง</FieldLabel><Input id="conditionValue" name="conditionValue" maxLength={191} placeholder="ใส่ตัวเลือกหนึ่งค่าจากฟิลด์ด้านบน" /></Field>
              <Field orientation="horizontal">
                <input id="fieldRequired" name="required" type="checkbox" className="size-4 accent-primary" />
                <FieldLabel htmlFor="fieldRequired">บังคับกรอก</FieldLabel>
              </Field>
              <Field orientation="horizontal"><input id="fieldCheckin" name="showOnCheckin" type="checkbox" className="size-4 accent-primary" /><FieldLabel htmlFor="fieldCheckin">แสดงคำตอบบนหน้าจอเช็คชื่อ (ไม่ใช้กับไฟล์หรือข้อมูลอ่อนไหว)</FieldLabel></Field>
              <Field orientation="horizontal"><input id="fieldSensitive" name="sensitive" type="checkbox" className="size-4 accent-primary" /><FieldLabel htmlFor="fieldSensitive">ข้อมูลอ่อนไหว ต้องเปิดดูและส่งออกโดยยืนยัน</FieldLabel></Field>
            </FieldGroup>
            <div className="flex justify-end"><Button type="submit" variant="outline">เพิ่มฟิลด์</Button></div>
          </form>
        )}
      </section>}

      {(step === 2 || step === 4) && <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-2xl font-bold">{step === 2 ? "วันที่จัดอบรม & ที่นั่ง" : "รอบเช็คชื่อ"}</h2>
          <p className="text-sm text-muted-foreground">{step === 2 ? "คลิกเลือกหลายวันในปฏิทินได้ ไม่จำเป็นต้องต่อเนื่อง กำหนดที่นั่งเริ่มต้นพร้อมกันแล้วแก้แยกแต่ละวันได้" : "เพิ่มอย่างน้อยหนึ่งรอบต่อโครงการ เลือกได้ว่าจะใช้ทุกวันหรือผูกกับวันจัดเฉพาะ"}</p>
        </div>
        <div className={cn("grid items-start gap-6", step === 2 && "xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]")}>
        {step === 2 && <EventDayCalendar action={addDay} selectedDays={days.map((day) => day.date.toISOString().slice(0, 10))} today={todayInBangkok} seatMode={event.seatMode} />}
        <div className="flex flex-col gap-4">
        {step === 2 && <div className="flex items-center justify-between rounded-xl border bg-card px-5 py-4"><h3 className="font-heading text-lg font-bold">เลือกแล้ว {days.length} วัน</h3><span className="text-sm text-muted-foreground">{event.seatMode === "whole_course" ? `ที่นั่งทั้งหลักสูตร ${event.maxSeats?.toLocaleString("th-TH") ?? "ไม่จำกัด"}` : `ที่นั่งรวม ${days.reduce((sum, day) => sum + (day.maxSeats ?? 0), 0).toLocaleString("th-TH")}${days.some((day) => day.maxSeats === null) ? " + ไม่จำกัด" : ""}`}</span></div>}
        {step === 4 && <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <div><h3 className="font-heading text-lg font-semibold">รอบเช็คชื่อที่ใช้ได้ทุกวัน</h3><p className="text-sm text-muted-foreground">รอบแบบไม่ผูกวันใช้เช็คชื่อได้กับผู้ลงทะเบียนทุกวันของโครงการ</p></div>
          {globalSessions.map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
            <form action={updateSession.bind(null, eventId, session.id)} className="flex flex-wrap items-center gap-2"><Input name="label" aria-label="ชื่อรอบเช็คชื่อที่ใช้ได้ทุกวัน" defaultValue={session.label} maxLength={191} className="max-w-56" /><span className="text-xs text-muted-foreground">เช็คชื่อแล้ว {session._count.checkIns} คน</span><Button type="submit" variant="ghost" size="sm">แก้ชื่อ</Button></form>
            <RemoveSessionForm action={removeSession.bind(null, eventId, session.id)} checkIns={session._count.checkIns} />
          </div>)}
          <form action={addSessionForScope.bind(null, eventId)} className="flex flex-wrap items-end gap-3">
            <Field className="min-w-48 flex-1"><FieldLabel htmlFor="global-session-label">ชื่อรอบใหม่</FieldLabel><Input id="global-session-label" name="label" maxLength={191} placeholder="เช้า / บ่าย / เต็มวัน" required /></Field>
            <Field className="min-w-56 flex-1"><FieldLabel htmlFor="global-session-scope">ขอบเขต</FieldLabel><NativeSelect id="global-session-scope" name="scope" defaultValue="EVENT"><option value="EVENT">ใช้ได้ทุกวัน (รอบเดียว)</option><option value="EACH_DAY">สร้างรอบแยกให้ทุกวัน</option>{days.map((day, index) => <option key={day.id} value={day.id}>ผูกกับวันที่ {index + 1} · {dateFormatter.format(day.date)}</option>)}</NativeSelect></Field>
            <Button type="submit" variant="outline">เพิ่มรอบ</Button>
          </form>
        </section>}
        {days.length === 0 && <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{step === 2 ? "ยังไม่มีวันที่จัด เพิ่มอย่างน้อย 1 วันก่อนเผยแพร่โครงการ" : "กรุณาเพิ่มวันที่จัดในขั้นที่ 2 ก่อน"}</p>}

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
            {step === 4 && <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">รอบเช็คชื่อ</h4>
              {day.sessions.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีรอบเช็คชื่อของวันนี้</p>}
              {day.sessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <form action={updateSession.bind(null, eventId, session.id)} className="flex flex-wrap items-center gap-2"><Input name="label" aria-label="ชื่อรอบ" defaultValue={session.label} maxLength={191} className="max-w-44" /><span className="text-xs text-muted-foreground">เช็คชื่อแล้ว {session._count.checkIns} คน</span><Button type="submit" variant="ghost" size="sm">แก้ชื่อ</Button></form>
                  <RemoveSessionForm action={removeSession.bind(null, eventId, session.id)} checkIns={session._count.checkIns} />
                </div>
              ))}
            </div>}
          </section>
        ))}
        </div>
        </div>
      </section>}

      {typeof error === "string" && error !== "invalid" && errorMessage[error] && (
        <p role="alert" className="text-sm text-destructive">{errorMessage[error]}</p>
      )}
      {saved && <p role="status" className="text-sm text-muted-foreground">บันทึกข้อมูลแล้ว</p>}

      {step === 5 && canAdminister && <section className="rounded-xl border bg-card p-6">
        <h2 className="font-heading text-xl font-semibold">ผู้ร่วมจัด</h2>
        <p className="mt-1 text-sm text-muted-foreground">เพิ่มจากอีเมลของบัญชีที่มีอยู่ในระบบ</p>
        <form action={addEventMember.bind(null, eventId)} className="mt-4 flex flex-wrap items-end gap-3">
          <Field className="min-w-52 flex-1"><FieldLabel htmlFor="memberEmail">อีเมล</FieldLabel><Input id="memberEmail" name="email" type="email" required /></Field>
          <Field className="min-w-48 flex-1"><FieldLabel htmlFor="memberRole">สิทธิ์</FieldLabel><NativeSelect id="memberRole" name="role"><option value="FULL">ผู้ร่วมจัดเต็มสิทธิ์</option><option value="CHECKIN_ONLY">เช็คชื่ออย่างเดียว</option></NativeSelect></Field>
          <Button type="submit">เพิ่ม / เปลี่ยนสิทธิ์</Button>
        </form>
        {members.map((member) => <div key={member.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"><span>{member.user.name} ({member.user.email}) · {member.role === "FULL" ? "เต็มสิทธิ์" : "เช็คชื่ออย่างเดียว"}</span><form action={removeEventMember.bind(null, eventId, member.userId)}><Button type="submit" variant="ghost" size="sm">นำออก</Button></form></div>)}
        {(error === "invalid-member" || error === "member-not-found") && <p role="alert" className="mt-3 text-sm text-destructive">ไม่พบบัญชีที่ใช้งานได้ หรือข้อมูลผู้ร่วมจัดไม่ถูกต้อง</p>}
      </section>}
      {step === 5 && <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-6">
        <form action={cloneEvent.bind(null, eventId)}><Button type="submit" variant="outline">ทำสำเนาโครงการ</Button></form>
        {event.status === "DRAFT" || event.status === "CLOSED" ? (
          <form action={changeEventStatus.bind(null, eventId, "PUBLISHED")}>
            <Button type="submit" disabled={!readyToPublish}>เผยแพร่โครงการ</Button>
          </form>
        ) : (
          <form action={changeEventStatus.bind(null, eventId, "CLOSED")}>
            <Button type="submit" variant="outline">ปิดรับลงทะเบียน</Button>
          </form>
        )}
        {event.status !== "DRAFT" && <Button asChild variant="outline"><Link href={`/organizer/${eventId}/registrants`}>จัดการผู้ลงทะเบียน</Link></Button>}
        {event.status !== "DRAFT" && <Button asChild variant="outline"><Link href={`/organizer/${eventId}/dashboard`}>แดชบอร์ด</Link></Button>}
        {event.status !== "DRAFT" && <Button asChild variant="outline"><Link href={`/check-in/${eventId}`}>เช็คชื่อหน้างาน</Link></Button>}
        {event.status === "PUBLISHED" && <Button asChild variant="link"><Link href={`/events/${event.slug}`}>หน้าลงทะเบียนสาธารณะ</Link></Button>}
      </section>}
      {step === 5 && canAdminister && <section className="rounded-xl border border-destructive/40 bg-card p-6">
        <h2 className="font-heading text-lg font-semibold">ลบโครงการ</h2>
        <p className="mt-1 text-sm text-muted-foreground">ถ้ามีผู้ลงทะเบียนแล้ว ระบบจะเก็บข้อมูลเดิมไว้ตรวจสอบย้อนหลัง และปิดหน้าโครงการจากผู้ใช้งาน</p>
        <form action={deleteOwnedEvent.bind(null, eventId)} className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required />ยืนยันลบโครงการนี้</label>
          <Button type="submit" variant="destructive">ลบโครงการ</Button>
        </form>
        {error === "confirm-delete" && <p role="alert" className="mt-2 text-sm text-destructive">กรุณายืนยันก่อนลบ</p>}
      </section>}
      {step === 5 && error === "not-ready" && <p role="alert" className="text-sm text-destructive">กรุณาตรวจรายการที่ยังไม่พร้อมก่อนเผยแพร่โครงการ</p>}
      {step === 5 && event.status === "DRAFT" && (
        <section className="rounded-xl border bg-card p-6">
          <h2 className="font-heading text-lg font-semibold">ก่อนเผยแพร่</h2>
          <p className="mt-2 text-sm text-muted-foreground">ตรวจเงื่อนไขการเผยแพร่ก่อนเปิดรับสมัคร</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="รายการตรวจสอบก่อนเผยแพร่">
            {publishChecks.map((check) => <li key={check.label} className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
              <span aria-hidden="true" className={check.ready ? "text-primary" : "text-destructive"}>{check.ready ? "✓" : "•"}</span>
              <span>{check.label}: {check.ready ? "พร้อม" : "ยังไม่พร้อม"}{check.note ? <span className="block text-xs text-muted-foreground">{check.note}</span> : null}</span>
            </li>)}
          </ul>
          {hasFileFields && process.env.NODE_ENV === "production" && <p className="mt-3 text-sm text-muted-foreground">production ต้องตั้งค่า private object storage สำหรับฟิลด์ไฟล์ก่อน</p>}
        </section>
      )}
    </main>
    <footer className="sticky bottom-0 mt-auto flex flex-wrap items-center justify-between gap-3 border-t bg-card px-4 py-3 shadow-[0_-4px_16px_rgb(0_0_0/0.04)] sm:px-6 sm:py-4 lg:px-12">
      {step > 1 ? <Button asChild variant="outline"><Link href={`/organizer/${eventId}?step=${step - 1}`}>ย้อนกลับ</Link></Button> : <Button asChild variant="outline"><Link href="/organizer">โครงการของฉัน</Link></Button>}
      <span className="text-sm text-muted-foreground">ขั้นที่ {step} จาก 5</span>
      {step < 5 ? <Button asChild><Link href={`/organizer/${eventId}?step=${step + 1}`}>ถัดไป: {wizardSteps[step].label}</Link></Button> : <Button asChild variant="outline"><Link href="/organizer">กลับไปรายการโครงการ</Link></Button>}
    </footer>
    </div>
    </div>
  );
}
