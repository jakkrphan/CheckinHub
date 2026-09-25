import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { CheckCircle2Icon, Clock3Icon, ShieldAlertIcon, TicketIcon } from "lucide-react";

import { cancelRegistration } from "@/app/(public)/events/[slug]/status/[token]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hashBearerCode } from "@/server/registrations/registration";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "สถานะการลงทะเบียน" };

const statusLabel = {
  PENDING: "รอผู้จัดอนุมัติ",
  APPROVED: "อนุมัติแล้ว",
  REJECTED: "ไม่อนุมัติ",
  WAITLISTED: "อยู่ในคิวสำรอง",
  CANCELLED: "ยกเลิกแล้ว",
} as const;

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});

export default async function RegistrationStatusPage({ params, searchParams }: PageProps<"/events/[slug]/status/[token]">) {
  const { slug, token } = await params;
  const { error, cancelled } = await searchParams;
  const registrant = await db.registrant.findUnique({
    where: { statusTokenHash: hashBearerCode(token) },
    include: {
      event: { select: { slug: true, title: true, location: true, seatMode: true, deletedAt: true } },
      days: { include: { eventDay: { select: { date: true } } }, orderBy: { eventDay: { date: "asc" } } },
    },
  });
  if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt) notFound();

  const queuePositions = new Map(await Promise.all(registrant.days.filter((day) => day.status === "WAITLISTED" && day.waitlistedAt).map(async (day) => [day.id, registrant.event.seatMode === "whole_course" ? await db.registrant.count({ where: { eventId: registrant.eventId, status: "WAITLISTED", OR: [{ registeredAt: { lt: registrant.registeredAt } }, { registeredAt: registrant.registeredAt, id: { lte: registrant.id } }] } }) : await db.registrantEventDay.count({ where: { eventDayId: day.eventDayId, status: "WAITLISTED", OR: [{ waitlistedAt: { lt: day.waitlistedAt! } }, { waitlistedAt: day.waitlistedAt!, id: { lte: day.id } }] } })] as const)));

  const qrDataUrl = registrant.status === "APPROVED" && registrant.qrCode
    ? await QRCode.toDataURL(registrant.qrCode, { width: 320, margin: 2 })
    : null;
  const cancel = cancelRegistration.bind(null, slug, token);
  const statusIcon = registrant.status === "APPROVED" ? CheckCircle2Icon : registrant.status === "WAITLISTED" || registrant.status === "PENDING" ? Clock3Icon : ShieldAlertIcon;
  const StatusIcon = statusIcon;
  const statusText = registrant.status === "APPROVED" ? "ลงทะเบียนสำเร็จ · พร้อมเช็คชื่อ" : registrant.status === "WAITLISTED" ? "ลงทะเบียนสำเร็จ · อยู่ในคิวรอ" : registrant.status === "PENDING" ? "ลงทะเบียนสำเร็จ · รออนุมัติ" : statusLabel[registrant.status];

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col bg-background">
      <header className="flex flex-col gap-2 bg-sidebar px-5 py-5 text-sidebar-foreground"><Link href={`/events/${slug}`} className="text-xs text-sidebar-foreground/70 hover:underline">← กลับไปหน้าโครงการ</Link><p className="text-xs text-sidebar-foreground/70">เช็คสถานะการลงทะเบียน</p><h1 className="font-heading text-lg font-bold leading-snug">{registrant.event.title}</h1></header>
      <div className="flex flex-col gap-5 px-5 py-6">
        <div className="flex flex-col items-center gap-3 text-center"><span className="flex size-20 items-center justify-center rounded-full bg-accent text-primary"><StatusIcon className="size-10" aria-hidden="true" /></span><h2 className="font-heading text-2xl font-bold">{statusText}</h2><Badge variant={registrant.status === "APPROVED" ? "default" : "secondary"}>{statusLabel[registrant.status]}</Badge></div>
        {registrant.status === "WAITLISTED" && <p className="rounded-xl border bg-card p-4 text-center text-sm text-muted-foreground">{registrant.event.seatMode === "whole_course" ? "ที่นั่งทั้งหลักสูตรเต็ม ระบบจัดคุณไว้ในคิวสำรองของโครงการ" : "วันที่เลือกมีที่นั่งเต็ม ระบบจัดคุณไว้ในคิวสำรอง หากมีคนยกเลิกจะเลื่อนคิวตามลำดับ"}</p>}
        {registrant.status === "PENDING" && <p className="rounded-xl border bg-card p-4 text-center text-sm text-muted-foreground">ผู้จัดจะตรวจใบสมัครก่อน เมื่ออนุมัติแล้ว QR จะปรากฏที่หน้านี้</p>}
        {registrant.status === "REJECTED" && registrant.rejectReason && <p className="rounded-xl border bg-card p-4 text-center text-sm text-muted-foreground">เหตุผลจากผู้จัด: {registrant.rejectReason}</p>}
        {cancelled && <p role="status" className="rounded-xl border bg-card p-4 text-sm">ยกเลิกวันที่เลือกแล้ว หากมีคิวสำรองระบบจะเลื่อนคนถัดไปตามลำดับ</p>}
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <h3 className="font-heading text-lg font-semibold">ข้อมูลของคุณ</h3>
          <div className="flex flex-col gap-2 text-sm"><p><span className="text-muted-foreground">อีเมล</span><br />{registrant.email}</p>{registrant.event.location && <p><span className="text-muted-foreground">สถานที่</span><br />{registrant.event.location}</p>}</div>
          <div className="flex flex-col gap-2 border-t pt-3">{registrant.days.map((day, index) => <div key={day.id} className="flex items-center justify-between gap-3 text-sm"><span>วันที่ {index + 1} · {dateFormatter.format(day.eventDay.date)}</span><Badge variant={day.status === "APPROVED" ? "default" : "secondary"}>{statusLabel[day.status]}{queuePositions.has(day.id) ? ` · คิวที่ ${queuePositions.get(day.id)}` : ""}</Badge></div>)}</div>
        </section>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">เก็บลิงก์หน้านี้ไว้เพื่อตรวจสถานะหรือดู QR อีกครั้ง อย่าแชร์ลิงก์กับผู้อื่น</p>
      {qrDataUrl && (
        <section className="flex flex-col items-center gap-4 rounded-xl bg-primary p-5 text-primary-foreground">
          <div className="flex items-center gap-2"><TicketIcon className="size-5" aria-hidden="true" /><h3 className="font-heading text-lg font-bold">บัตร QR สำหรับเช็คชื่อ</h3></div>
          <div className="flex w-full flex-col items-center gap-3 rounded-xl bg-card p-5 text-card-foreground">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} width={240} height={240} alt="QR สำหรับเช็คชื่อ" className="size-60" />
          <p className="break-all text-center text-xs text-muted-foreground">{registrant.qrCode}</p>
          </div>
          <p className="text-center text-xs">ใช้ QR เดียวกันเช็คชื่อได้ในวันที่อนุมัติแล้ว</p>
          <Button variant="secondary" asChild className="w-full"><a href={qrDataUrl} download="checkinhub-qr.png">บันทึก QR ลงเครื่อง</a></Button>
          <Button variant="outline" asChild className="w-full"><a href={`/events/${slug}/status/${token}/calendar`}>ดาวน์โหลดวันที่เข้าอบรม (.ics)</a></Button>
        </section>
      )}
      {registrant.event.seatMode !== "whole_course" && registrant.days.filter((day) => ["PENDING", "APPROVED", "WAITLISTED"].includes(day.status)).length > 1 && <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h3 className="font-heading text-lg font-semibold">ยกเลิกเฉพาะบางวัน</h3>
        {registrant.days.filter((day) => ["PENDING", "APPROVED", "WAITLISTED"].includes(day.status)).map((day) => <form key={day.id} action={cancel} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <span className="text-sm">{dateFormatter.format(day.eventDay.date)}</span>
          <input type="hidden" name="dayId" value={day.eventDayId} />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" required />ยืนยัน</label>
          <Button type="submit" variant="outline" size="sm">ยกเลิกวันนี้</Button>
        </form>)}
      </section>}
      {["PENDING", "APPROVED", "WAITLISTED"].includes(registrant.status) && (
        <form action={cancel} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <div className="flex flex-col gap-1"><h3 className="font-heading text-lg font-semibold text-destructive">มาไม่ได้?</h3><p className="text-sm text-muted-foreground">ยกเลิกเพื่อคืนที่นั่งให้คนที่รออยู่ในคิว เมื่อยกเลิกแล้ว QR เดิมใช้เช็คชื่อไม่ได้</p></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" className="size-4 accent-primary" required />ยืนยันว่าต้องการยกเลิกการเข้าร่วม</label>
          {error && <p role="alert" className="text-sm text-destructive">{error === "checked-in" ? "เช็คชื่อแล้ว ไม่สามารถยกเลิกด้วยตนเองได้" : error === "retry" ? "ระบบกำลังทำรายการอื่น กรุณาลองใหม่" : "กรุณายืนยันก่อนยกเลิก"}</p>}
          <Button type="submit" variant="destructive">ยกเลิกการเข้าร่วม</Button>
        </form>
      )}
      </div>
    </main>
  );
}
