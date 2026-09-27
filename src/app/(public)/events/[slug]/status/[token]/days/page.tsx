import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/server/db";
import { todayInBangkok } from "@/server/registrations/day-change";
import { getSeatAvailability } from "@/server/registrations/day-status";
import { hashBearerCode } from "@/server/registrations/registration";
import { canSelfEdit } from "@/server/registrations/self-edit";
import { isFeatureEnabled } from "@/server/settings/features";

import { changeOwnDaysAction } from "../actions";
import { ChangeDaysForm } from "./change-days-form";

export const metadata: Metadata = { title: "เปลี่ยนวันที่เข้าร่วม", referrer: "no-referrer" };

const dayFormatter = new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const deadlineFormatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Bangkok" });
const statusLabel = { PENDING: "รออนุมัติ", APPROVED: "อนุมัติแล้ว", WAITLISTED: "คิวสำรอง", REJECTED: "ไม่อนุมัติ", CANCELLED: "ยกเลิกแล้ว" } as const;
const errors: Record<string, string> = {
  invalid: "เลือกวันไม่ถูกต้อง หรือเลือกวันที่ผู้จัดไม่อนุมัติไว้",
  "day-closed": "วันที่เลือกปิดรับแล้วหรือผ่านไปแล้ว",
  "checked-in": "ยกเลิกวันที่เช็คชื่อแล้วไม่ได้",
  closed: "เปลี่ยนวันไม่ได้แล้ว เนื่องจากปิดรับลงทะเบียน หรือการลงทะเบียนถูกยกเลิก/ไม่อนุมัติ",
  unavailable: "ระบบกำลังทำรายการอื่น กรุณาลองใหม่",
};

export default async function ChangeDaysPage({ params, searchParams }: PageProps<"/events/[slug]/status/[token]/days">) {
  const { slug, token } = await params;
  const { error } = await searchParams;
  const registrant = await db.registrant.findUnique({
    where: { statusTokenHash: hashBearerCode(token) },
    select: {
      id: true, status: true, anonymizedAt: true,
      days: { select: { eventDayId: true, status: true } },
      checkIns: { where: { voidedAt: null }, select: { session: { select: { eventDayId: true } } } },
      event: { select: { id: true, slug: true, title: true, status: true, registrationDeadline: true, deletedAt: true, seatMode: true, maxSeats: true, autoApprove: true, days: { orderBy: { date: "asc" }, select: { id: true, date: true, isClosed: true } } } },
    },
  });
  if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt) notFound();
  const statusUrl = `/events/${slug}/status/${token}`;
  const featureOn = await isFeatureEnabled("selfDayChange");
  const editable = featureOn && registrant.event.seatMode === "per_day" && canSelfEdit(registrant, registrant.event);
  const availability = await getSeatAvailability(db, registrant.event, registrant.event.days.map((day) => day.id));
  const rows = new Map(registrant.days.map((row) => [row.eventDayId, row.status]));
  const checkedDays = new Set(registrant.checkIns.map((checkIn) => checkIn.session.eventDayId));
  const today = todayInBangkok();
  const days = registrant.event.days.map((day, index) => {
    const status = rows.get(day.id);
    const selected = status === "PENDING" || status === "APPROVED" || status === "WAITLISTED";
    const locked = checkedDays.has(day.id) ? "เช็คชื่อแล้ว" : status === "REJECTED" ? "ผู้จัดไม่อนุมัติวันนี้"
      : day.date.toISOString().slice(0, 10) < today ? "ผ่านไปแล้ว" : day.isClosed && !selected ? "ปิดรับวันนี้" : null;
    return { id: day.id, number: index + 1, label: dayFormatter.format(day.date), selected, statusLabel: status ? statusLabel[status] : null,
      remaining: availability.mode === "per_day" ? availability.days.get(day.id)?.remaining ?? null : null, locked };
  });

  return <main className="mx-auto flex min-h-svh w-full max-w-lg md:my-10 md:min-h-0 md:max-w-xl md:overflow-clip md:rounded-2xl md:border md:shadow-sm lg:max-w-2xl flex-col bg-background">
    <header className="flex flex-col gap-2 bg-sidebar px-5 py-5 text-sidebar-foreground">
      <Link href={statusUrl} className="-my-3 w-fit py-3 text-xs text-sidebar-foreground/70 hover:underline">← กลับไปหน้าสถานะ</Link>
      <p className="text-xs text-sidebar-foreground/70">เปลี่ยนวันที่เข้าร่วม</p>
      <h1 className="font-heading text-lg font-bold leading-snug">{registrant.event.title}</h1>
    </header>
    <div className="flex flex-col gap-4 px-5 py-6">
      {!editable ? <p role="status" className="rounded-xl border bg-card p-5 text-sm">{!featureOn ? "ขณะนี้ปิดการเปลี่ยนวันด้วยตนเอง" : registrant.event.seatMode !== "per_day" ? "โครงการนี้เป็นหลักสูตรต่อเนื่อง ต้องเข้าร่วมครบทุกวัน จึงเปลี่ยนวันไม่ได้" : errors.closed} หากจำเป็นกรุณาติดต่อผู้จัด</p> : <>
        <p className="text-sm text-muted-foreground">เพิ่มหรือยกเลิกบางวันได้จนถึง {deadlineFormatter.format(registrant.event.registrationDeadline!)} · QR เดิมใช้ต่อได้</p>
        {typeof error === "string" && errors[error] && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{errors[error]}</p>}
        <ChangeDaysForm action={changeOwnDaysAction.bind(null, slug, token)} days={days} autoApprove={registrant.event.autoApprove} />
      </>}
    </div>
  </main>;
}
