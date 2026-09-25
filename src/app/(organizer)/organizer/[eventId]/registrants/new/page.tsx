import { RegistrationForm } from "@/app/(public)/events/[slug]/registration-form";
import { OrganizerEventHeader } from "../../event-header";
import { readRegistrationFields, validateRegistrationFields } from "@/features/events/registration-fields";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";
import { getSeatAvailability } from "@/server/registrations/day-status";

const errorMessages: Record<string, string> = {
  invalid: "กรุณาตรวจสอบข้อมูลและคำตอบฟอร์ม", duplicate: "อีเมลนี้ลงทะเบียนโครงการแล้ว",
  consent: "ต้องยืนยันว่าได้รับความยินยอมก่อนบันทึก", "not-open": "โครงการฉบับร่างยังเพิ่มผู้สมัครไม่ได้", retry: "ระบบกำลังทำรายการอื่น กรุณาลองใหม่",
};

export default async function NewRegistrantPage({ params, searchParams }: PageProps<"/organizer/[eventId]/registrants/new">) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const { event } = await requireEventAccess(eventId, "manage");
  const fields = readRegistrationFields(event.fields);
  const eventDays = await db.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true, date: true, maxSeats: true, isClosed: true } });
  const formatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeZone: "UTC" });
  const availability = await getSeatAvailability(db, event, eventDays.map((day) => day.id));
  const days = eventDays.map((day) => ({ id: day.id, label: formatter.format(day.date), maxSeats: day.maxSeats, isClosed: day.isClosed, remaining: availability.mode === "per_day" ? availability.days.get(day.id)?.remaining ?? null : null }));
  const ready = event.status !== "DRAFT" && days.some((day) => event.seatMode === "whole_course" || !day.isClosed) && validateRegistrationFields(fields)
    && fields.every((field) => field.type !== "file" || process.env.NODE_ENV !== "production");
  return <>
    <OrganizerEventHeader event={event} activeTab="registrants" />
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-8">
    <div><h2 className="font-heading text-2xl font-bold">เพิ่มผู้สมัครด้วยมือ</h2><p className="mt-2 text-sm text-muted-foreground">ใช้เมื่อรับสมัครหน้างานหรือช่วยกรอกแทนผู้เข้าร่วม ผู้จัดต้องได้รับความยินยอมก่อนบันทึกข้อมูล</p></div>
    <p className="rounded-lg border p-4 text-sm">หลังบันทึก ระบบเปิดหน้าสถานะพร้อม QR (ถ้าอนุมัติแล้ว) ให้คัดลอกลิงก์ส่งให้ผู้เข้าร่วมเอง ระหว่างที่ยังไม่เชื่อมอีเมล/LINE</p>
    {typeof error === "string" && errorMessages[error] && <p role="alert" className="text-sm text-destructive">{errorMessages[error]}</p>}
    {ready ? <RegistrationForm slug={event.slug} organizerEventId={eventId} fields={fields} days={days} captchaSiteKey="" seatMode={event.seatMode} courseRemaining={availability.mode === "whole_course" ? availability.remaining : null} /> : <p className="text-sm text-muted-foreground">โครงการนี้ยังไม่พร้อมรับผู้สมัคร</p>}
  </main>;
  </>;
}
