import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { CalendarDaysIcon, CalendarPlusIcon, CheckCircle2Icon, Clock3Icon, DownloadIcon, PencilIcon, ShieldAlertIcon } from "lucide-react";

import { cancelRegistration } from "@/app/(public)/events/[slug]/status/[token]/actions";
import { Button } from "@/components/ui/button";
import { registrationFieldsSchema } from "@/features/events/registration-fields";
import { cn } from "@/lib/utils";
import { hashBearerCode } from "@/server/registrations/registration";
import { db } from "@/server/db";
import { canSelfEdit } from "@/server/registrations/self-edit";

export const metadata: Metadata = { title: "สถานะการลงทะเบียน" };

type Status = "PENDING" | "APPROVED" | "REJECTED" | "WAITLISTED" | "CANCELLED";

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
const shortDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });

function StatusChip({ status, queue }: { status: Status; queue?: number }) {
  const [label, tone] = status === "APPROVED" ? ["อนุมัติแล้ว", "bg-accent text-accent-foreground"]
    : status === "WAITLISTED" ? [queue ? `รอคิว #${queue}` : "รอคิว", "bg-[var(--status-warning-background)] text-[var(--status-warning)]"]
    : status === "PENDING" ? ["รออนุมัติ", "bg-muted text-foreground"]
    : [statusLabel[status], "bg-muted text-muted-foreground"];
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-semibold whitespace-nowrap", tone)}>{label}</span>;
}

function displayNameOf(answers: unknown, fieldsJson: unknown, email: string | null) {
  const values = answers && typeof answers === "object" && !Array.isArray(answers) ? answers as Record<string, unknown> : {};
  if (typeof values.name === "string" && values.name.trim()) return values.name.trim();
  const fields = registrationFieldsSchema.safeParse(fieldsJson);
  const firstText = fields.success ? fields.data.find((field) => field.type === "text" && field.required && typeof values[field.key] === "string" && (values[field.key] as string).trim()) : undefined;
  if (firstText) return (values[firstText.key] as string).trim();
  return email ?? "ผู้ลงทะเบียน";
}

export default async function RegistrationStatusPage({ params, searchParams }: PageProps<"/events/[slug]/status/[token]">) {
  const { slug, token } = await params;
  const { error, cancelled, updated, days: daysChanged } = await searchParams;
  const registrant = await db.registrant.findUnique({
    where: { statusTokenHash: hashBearerCode(token) },
    include: {
      event: { select: { slug: true, title: true, location: true, seatMode: true, deletedAt: true, status: true, registrationDeadline: true, fields: true, days: { orderBy: { date: "asc" }, select: { id: true } } } },
      days: { include: { eventDay: { select: { date: true } } }, orderBy: { eventDay: { date: "asc" } } },
    },
  });
  if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt) notFound();

  const queuePositions = new Map(await Promise.all(registrant.days.filter((day) => day.status === "WAITLISTED" && day.waitlistedAt).map(async (day) => [day.id, registrant.event.seatMode === "whole_course" ? await db.registrant.count({ where: { eventId: registrant.eventId, status: "WAITLISTED", OR: [{ registeredAt: { lt: registrant.registeredAt } }, { registeredAt: registrant.registeredAt, id: { lte: registrant.id } }] } }) : await db.registrantEventDay.count({ where: { eventDayId: day.eventDayId, status: "WAITLISTED", OR: [{ waitlistedAt: { lt: day.waitlistedAt! } }, { waitlistedAt: day.waitlistedAt!, id: { lte: day.id } }] } })] as const)));

  const qrDataUrl = registrant.status === "APPROVED" && registrant.qrCode
    ? await QRCode.toDataURL(registrant.qrCode, { width: 320, margin: 1 })
    : null;
  const cancel = cancelRegistration.bind(null, slug, token);
  // Day numbers follow the event's own day order, not the registrant's subset of days.
  const dayNumber = new Map(registrant.event.days.map((day, index) => [day.id, index + 1]));
  const dayLabel = (day: (typeof registrant.days)[number]) => `วันที่ ${dayNumber.get(day.eventDayId) ?? "?"} · ${dateFormatter.format(day.eventDay.date)}`;
  const activeDays = registrant.days.filter((day) => ["PENDING", "APPROVED", "WAITLISTED"].includes(day.status));
  const approvedDays = registrant.days.filter((day) => day.status === "APPROVED");
  const waitlistedDays = registrant.days.filter((day) => queuePositions.has(day.id));
  const queuePosition = waitlistedDays.length > 0 ? Math.min(...waitlistedDays.map((day) => queuePositions.get(day.id)!)) : null;
  const displayName = displayNameOf(registrant.answers, registrant.event.fields, registrant.email);
  const heroText = registrant.status === "WAITLISTED" ? "ลงทะเบียนสำเร็จ · อยู่ในคิวรอ" : registrant.status === "PENDING" ? "ลงทะเบียนสำเร็จ · รออนุมัติ" : registrant.status === "APPROVED" ? "ลงทะเบียนสำเร็จ · พร้อมเช็คชื่อ" : statusLabel[registrant.status];
  const HeroIcon = registrant.status === "APPROVED" ? CheckCircle2Icon : registrant.status === "WAITLISTED" || registrant.status === "PENDING" ? Clock3Icon : ShieldAlertIcon;
  const notice = "rounded-xl border bg-card p-4 text-sm";

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg md:my-10 md:min-h-0 md:max-w-xl md:overflow-clip md:rounded-2xl md:border md:shadow-sm lg:max-w-2xl flex-col bg-background">
      <header className="flex flex-col gap-2 bg-sidebar px-5 py-5 text-sidebar-foreground"><Link href={`/events/${slug}`} className="-my-3 w-fit py-3 text-xs text-sidebar-foreground/70 hover:underline">← กลับไปหน้าโครงการ</Link><p className="text-xs text-sidebar-foreground/70">เช็คสถานะการลงทะเบียน</p><h1 className="font-heading text-lg font-bold leading-snug">{registrant.event.title}</h1></header>
      <div className="flex flex-col gap-4 px-5 py-6">
        {updated === "1" && <p role="status" className={notice}>บันทึกการแก้ไขข้อมูลแล้ว</p>}
        {updated === "0" && <p role="status" className={notice}>ไม่มีข้อมูลที่เปลี่ยนแปลง</p>}
        {daysChanged === "1" && <p role="status" className={notice}>บันทึกการเปลี่ยนวันแล้ว · ดูสถานะของแต่ละวันด้านล่าง</p>}
        {cancelled && <p role="status" className={notice}>ยกเลิกวันที่เลือกแล้ว หากมีคิวสำรองระบบจะเลื่อนคนถัดไปตามลำดับ</p>}

        {qrDataUrl ? (
          <section aria-labelledby="ticket-title" className="flex flex-col gap-4 rounded-2xl bg-primary px-4 pt-5 pb-4 text-primary-foreground">
            <p className="flex items-center justify-center gap-2 font-heading font-bold"><CheckCircle2Icon className="size-6" aria-hidden="true" />{heroText}</p>
            <div className="flex flex-col gap-4 rounded-2xl bg-card px-5 py-5 text-card-foreground">
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">บัตรเข้าร่วมอบรม</p>
                <h2 id="ticket-title" className="font-heading text-lg font-bold leading-snug">{registrant.event.title}</h2>
                {registrant.event.location && <p className="text-sm text-muted-foreground">{registrant.event.location}</p>}
              </div>
              <div aria-hidden="true" className="relative"><span className="absolute top-1/2 -left-[30px] size-5 -translate-y-1/2 rounded-full bg-primary" /><div className="border-t-2 border-dashed" /><span className="absolute top-1/2 -right-[30px] size-5 -translate-y-1/2 rounded-full bg-primary" /></div>
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} width={208} height={208} alt="QR สำหรับเช็คชื่อ" className="size-52" />
                <p className="break-all text-center font-mono text-sm font-bold tracking-wide">{registrant.qrCode}</p>
                <p className="text-center text-xs text-muted-foreground">รหัสสุ่ม ใช้ QR นี้เช็คชื่อได้ทุกรอบของวันที่คุณเลือก</p>
              </div>
              <div className="flex items-start justify-between gap-4 border-t pt-3 text-sm">
                <div className="flex min-w-0 flex-col"><span className="text-xs text-muted-foreground">ผู้เข้าร่วม</span><strong className="break-words">{displayName}</strong></div>
                <div className="flex min-w-0 flex-col text-right"><span className="text-xs text-muted-foreground">วันที่</span><strong>{approvedDays.map((day) => `${shortDateFormatter.format(day.eventDay.date)} (วันที่ ${dayNumber.get(day.eventDayId) ?? "?"})`).join(", ") || "—"}</strong></div>
              </div>
            </div>
            <p className="text-center text-xs">ใช้ QR เดียวกันเช็คชื่อได้ในวันที่อนุมัติแล้ว</p>
            <Button asChild className="h-12 w-full bg-foreground text-base font-bold text-background hover:bg-foreground/90"><a href={qrDataUrl} download="checkinhub-qr.png"><DownloadIcon aria-hidden="true" />บันทึก QR ลงเครื่อง</a></Button>
            <Button asChild variant="outline" className="h-11 w-full border-primary-foreground/50 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"><a href={`/events/${slug}/status/${token}/calendar`}><CalendarPlusIcon aria-hidden="true" />ดาวน์โหลดวันที่เข้าอบรม (.ics)</a></Button>
          </section>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <span className={cn("flex size-20 items-center justify-center rounded-full", registrant.status === "WAITLISTED" ? "bg-[var(--status-warning-background)] text-[var(--status-warning)]" : registrant.status === "PENDING" || registrant.status === "APPROVED" ? "bg-accent text-primary" : "bg-muted text-muted-foreground")}><HeroIcon className="size-10" aria-hidden="true" /></span>
            <h2 className="font-heading text-2xl font-bold">{heroText}</h2>
            {registrant.status === "WAITLISTED" && <p className="text-sm leading-relaxed text-muted-foreground">{registrant.event.seatMode === "whole_course" ? "ที่นั่งทั้งหลักสูตรเต็ม ระบบจัดคุณไว้ในคิวสำรองของโครงการ" : "วันที่เลือกมีที่นั่งเต็ม ระบบจัดคุณไว้ในคิวสำรอง หากมีคนยกเลิกจะเลื่อนคิวตามลำดับ"}</p>}
            {registrant.status === "PENDING" && <p className="text-sm leading-relaxed text-muted-foreground">ผู้จัดจะตรวจใบสมัครก่อน เมื่ออนุมัติแล้ว QR จะปรากฏที่หน้านี้</p>}
            {registrant.status === "REJECTED" && registrant.rejectReason && <p className="w-full rounded-xl border bg-card p-4 text-sm text-muted-foreground">เหตุผลจากผู้จัด: {registrant.rejectReason}</p>}
          </div>
        )}

        {registrant.status === "WAITLISTED" && queuePosition !== null && (
          <section aria-label="ลำดับคิว" className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
            <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">ลำดับคิวของคุณ</span><strong className="font-heading text-4xl font-bold text-[var(--status-warning)]">#{queuePosition}</strong></div>
            {registrant.event.seatMode !== "whole_course" && <p className="border-t pt-3 text-xs text-muted-foreground">คิวของ {waitlistedDays.map((day) => `วันที่ ${dayNumber.get(day.eventDayId) ?? "?"} (${shortDateFormatter.format(day.eventDay.date)}) #${queuePositions.get(day.id)}`).join(", ")}{waitlistedDays.length > 1 ? " · แสดงลำดับที่ใกล้ที่สุด" : ""}</p>}
          </section>
        )}

        <section aria-labelledby="registrant-title" className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
          <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 flex-col gap-0.5"><h3 id="registrant-title" className="font-heading text-lg font-semibold break-words">{displayName}</h3>{registrant.email && registrant.email !== displayName && <p className="text-sm break-all text-muted-foreground">{registrant.email}</p>}</div><StatusChip status={registrant.status} queue={queuePosition ?? undefined} /></div>
          {registrant.event.location && !qrDataUrl && <p className="text-sm"><span className="text-muted-foreground">สถานที่</span><br />{registrant.event.location}</p>}
          <ul className="flex flex-col gap-2.5">{registrant.days.map((day) => <li key={day.id} className="flex items-center justify-between gap-3 text-sm"><span className={cn(["CANCELLED", "REJECTED"].includes(day.status) && "text-muted-foreground")}>{dayLabel(day)}</span><StatusChip status={day.status} queue={queuePositions.get(day.id)} /></li>)}</ul>
          {canSelfEdit(registrant, registrant.event) && <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button asChild variant="outline" className="h-11 min-w-fit flex-1"><Link href={`/events/${slug}/status/${token}/edit`}><PencilIcon aria-hidden="true" />แก้ไขข้อมูลของฉัน</Link></Button>
            {registrant.event.seatMode === "per_day" && <Button asChild variant="outline" className="h-11 min-w-fit flex-1"><Link href={`/events/${slug}/status/${token}/days`}><CalendarDaysIcon aria-hidden="true" />เปลี่ยนวันที่เข้าร่วม</Link></Button>}
          </div>}
        </section>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">เก็บลิงก์หน้านี้ไว้เพื่อตรวจสถานะหรือดู QR อีกครั้ง อย่าแชร์ลิงก์กับผู้อื่น</p>

        {registrant.event.seatMode !== "whole_course" && activeDays.length > 1 && <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
          <h3 className="font-heading text-lg font-semibold">ยกเลิกเฉพาะบางวัน</h3>
          {activeDays.map((day) => <form key={day.id} action={cancel} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3">
            <span className="text-sm">{dayLabel(day)}</span>
            <input type="hidden" name="dayId" value={day.eventDayId} />
            <span className="flex items-center gap-3"><label className="flex min-h-9 items-center gap-1.5 text-xs"><input type="checkbox" name="confirm" className="size-4 accent-primary" required />ยืนยัน</label><Button type="submit" variant="outline" size="sm">ยกเลิกวันนี้</Button></span>
          </form>)}
        </section>}
        {["PENDING", "APPROVED", "WAITLISTED"].includes(registrant.status) && (
          <form action={cancel} className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-card p-5">
            <div className="flex flex-col gap-1"><h3 className="font-heading text-lg font-semibold text-destructive">มาไม่ได้?</h3><p className="text-sm leading-relaxed text-muted-foreground">กดยกเลิกการเข้าร่วมเพื่อคืนที่นั่งให้คนที่รออยู่ในคิว — ยกเลิกแล้ว QR เดิมจะใช้เช็คชื่อไม่ได้อีก</p></div>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="confirm" className="size-5 accent-destructive" required />ยืนยันว่าต้องการยกเลิกการเข้าร่วม</label>
            {error && <p role="alert" className="text-sm text-destructive">{error === "checked-in" ? "เช็คชื่อแล้ว ไม่สามารถยกเลิกด้วยตนเองได้" : error === "retry" ? "ระบบกำลังทำรายการอื่น กรุณาลองใหม่" : "กรุณายืนยันก่อนยกเลิก"}</p>}
            <Button type="submit" variant="outline" className="h-11 border-destructive/40 text-base font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive">ยกเลิกการเข้าร่วม</Button>
          </form>
        )}
      </div>
    </main>
  );
}
