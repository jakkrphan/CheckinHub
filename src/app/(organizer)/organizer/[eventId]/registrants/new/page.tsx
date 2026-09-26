import type { Metadata } from "next";
import Link from "next/link";

import { WalkInForm } from "@/app/(organizer)/organizer/[eventId]/registrants/new/walk-in-form";
import { Button } from "@/components/ui/button";
import { readRegistrationFields, validateRegistrationFields } from "@/features/events/registration-fields";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";
import { getSeatAvailability } from "@/server/registrations/day-status";

import { OrganizerEventHeader } from "../../event-header";

export const metadata: Metadata = { title: "เพิ่มผู้ลงทะเบียนเอง" };

const errorMessages: Record<string, string> = {
  invalid: "กรุณาตรวจสอบข้อมูล: เลือกวันอย่างน้อย 1 วัน กรอกฟิลด์ที่บังคับ และอีเมลต้องถูกรูปแบบ (ถ้ากรอก)",
  duplicate: "อีเมลนี้ลงทะเบียนโครงการนี้แล้ว",
  consent: "ต้องยืนยันว่าได้รับความยินยอมก่อนบันทึก",
  "not-open": "โครงการฉบับร่างหรือวันที่ปิดรับ เพิ่มผู้ลงทะเบียนไม่ได้",
  retry: "ระบบกำลังทำรายการอื่น กรุณาลองใหม่",
};
const dayLabel = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function NewRegistrantPage({ params, searchParams }: PageProps<"/organizer/[eventId]/registrants/new">) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const { event } = await requireEventAccess(eventId, "manage");
  const fields = readRegistrationFields(event.fields);
  const eventDays = await db.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true, date: true, isClosed: true } });
  const availability = await getSeatAvailability(db, event, eventDays.map((day) => day.id));
  const days = eventDays.map((day, index) => ({
    id: day.id, number: index + 1, label: dayLabel.format(day.date), isClosed: day.isClosed,
    remaining: availability.mode === "per_day" ? availability.days.get(day.id)?.remaining ?? null : null,
  }));
  const ready = event.status !== "DRAFT" && days.some((day) => event.seatMode === "whole_course" || !day.isClosed) && validateRegistrationFields(fields)
    && fields.every((field) => field.type !== "file" || process.env.NODE_ENV !== "production");
  const backHref = `/organizer/${eventId}/registrants`;

  return <>
    <OrganizerEventHeader event={event} activeTab="registrants" />
    <main className="flex w-full flex-1 justify-center bg-muted/40 px-4 py-8 sm:px-6">
      <div className="w-full max-w-2xl">
        {ready ? <WalkInForm eventId={eventId} fields={fields} days={days} seatMode={event.seatMode === "whole_course" ? "whole_course" : "per_day"}
          courseRemaining={availability.mode === "whole_course" ? availability.remaining : null} backHref={backHref}
          error={typeof error === "string" ? errorMessages[error] : undefined} />
          : <div className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-6">
            <h2 className="font-heading text-xl font-bold">ยังเพิ่มผู้ลงทะเบียนไม่ได้</h2>
            <p className="text-sm text-muted-foreground">{event.status === "DRAFT" ? "โครงการยังเป็นฉบับร่าง — เผยแพร่ก่อนจึงจะเพิ่มผู้ลงทะเบียนได้" : "ต้องมีวันที่เปิดรับอย่างน้อย 1 วัน และฟอร์มลงทะเบียนที่ตั้งค่าถูกต้อง"}</p>
            <Button asChild variant="outline"><Link href={event.status === "DRAFT" ? `/organizer/${eventId}?step=5` : backHref}>{event.status === "DRAFT" ? "ไปหน้าเผยแพร่" : "กลับไปหน้าผู้ลงทะเบียน"}</Link></Button>
          </div>}
      </div>
    </main>
  </>;
}
