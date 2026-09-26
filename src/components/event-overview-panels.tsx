import Link from "next/link";
import type { ReactNode } from "react";

import { formatEventDayWithWeekday, formatTimeRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EventOverview, SessionProgress } from "@/server/events/overview";

function Meter({ value, max, label, tone = "ink" }: { value: number; max: number | null; label: string; tone?: "ink" | "primary" | "danger" }) {
  const percent = max ? Math.min(100, Math.round(value / max * 100)) : 0;
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max ?? undefined} aria-valuenow={value} className="h-2 overflow-hidden rounded-full bg-[#ece8df]">
    <div className={cn("h-full rounded-full", tone === "danger" ? "bg-destructive" : tone === "primary" ? "bg-primary" : "bg-foreground")} style={{ width: `${max ? percent : 0}%` }} />
  </div>;
}

function SessionRow({ session }: { session: SessionProgress }) {
  const time = formatTimeRange(session.startTime, session.endTime);
  return <div className="grid grid-cols-[minmax(0,1fr)_minmax(80px,1fr)_auto] items-center gap-3">
    <div className="flex min-w-0 flex-col"><span className="truncate font-semibold">{session.label}</span>{time && <span className="text-xs text-muted-foreground">{time}</span>}</div>
    <Meter value={session.checkedIn} max={session.expected || null} label={`เช็คชื่อ ${session.label} ${session.checkedIn} จาก ${session.expected}`} tone="primary" />
    <span className="text-sm tabular-nums"><strong className="font-heading text-base">{session.checkedIn}</strong><span className="text-muted-foreground">/{session.expected}</span></span>
  </div>;
}

/** Status strip, seat usage per day and per-session check-in progress for one event. */
export function EventOverviewPanels({ overview, seatMode, registrantsHref, aside }: { overview: EventOverview; seatMode: string; registrantsHref?: string; aside?: ReactNode }) {
  const { counts } = overview;
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const stats: { label: string; value: number; tone: string; status?: string }[] = [
    { label: "รออนุมัติ", value: counts.pending, tone: "text-amber-700", status: "PENDING" },
    { label: "รอคิว (waitlist)", value: counts.waitlisted, tone: "text-amber-700", status: "WAITLISTED" },
    { label: "อนุมัติแล้ว", value: counts.approved, tone: "text-primary", status: "APPROVED" },
    { label: "ปฏิเสธ", value: counts.rejected, tone: "text-muted-foreground", status: "REJECTED" },
    { label: "ยกเลิก / ถอนสิทธิ์", value: counts.cancelled, tone: "text-muted-foreground", status: "CANCELLED" },
  ];

  return <div className="flex flex-col gap-5">
    <section aria-label="สถานะผู้ลงทะเบียน" className="flex flex-wrap items-center gap-x-2 gap-y-4 rounded-xl border bg-card px-6 py-5">
      {stats.map((stat, index) => {
        const body = <><span className={cn("font-heading text-3xl font-bold tabular-nums", stat.tone)}>{stat.value.toLocaleString("th-TH")}</span><span className="text-sm text-muted-foreground">{stat.label}</span></>;
        return <div key={stat.label} className={cn("flex min-w-24 flex-col pr-6", index < stats.length - 1 && "sm:border-r")}>
          {registrantsHref && stat.status && stat.value > 0 ? <Link href={`${registrantsHref}?status=${stat.status}`} className="flex flex-col rounded-md outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body}
        </div>;
      })}
      {aside && <div className="ml-auto">{aside}</div>}
    </section>

    {overview.course && <section aria-label="ที่นั่งและความต่อเนื่องของหลักสูตร" className="grid gap-5 rounded-xl border bg-card p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2"><h2 className="font-heading text-lg font-bold">หลักสูตรต่อเนื่อง</h2><span className="text-sm tabular-nums">{overview.course.taken.toLocaleString("th-TH")} / {overview.course.max?.toLocaleString("th-TH") ?? "ไม่จำกัด"} ที่นั่ง</span></div>
        <Meter value={overview.course.taken} max={overview.course.max} label="ที่นั่งทั้งหลักสูตรที่ถูกจอง" tone={overview.course.max !== null && overview.course.taken >= overview.course.max ? "danger" : "ink"} />
        <p className="text-xs text-muted-foreground">นับรออนุมัติ + อนุมัติแล้ว · คิวสำรอง {overview.course.waitlisted.toLocaleString("th-TH")} คน</p>
      </div>
      {/* Mockup B v3: attendance continuity for whole-course events. The certificate pass count is deferred to a later version. */}
      {overview.continuity && <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading font-bold">ความต่อเนื่องของการเข้าอบรม</h3>
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">เฉพาะโหมดรวมทั้งคอร์ส</span>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">นับจาก {overview.continuity.totalSessions.toLocaleString("th-TH")} รอบของหลักสูตร · ผู้อนุมัติแล้ว {(overview.continuity.full + overview.continuity.missOne + overview.continuity.missMore).toLocaleString("th-TH")} คน</p>
        <div className="grid grid-cols-3 gap-3">
          {([
            ["เข้าครบทุกรอบ", overview.continuity.full, "text-primary"],
            ["ขาด 1 รอบ", overview.continuity.missOne, "text-amber-700"],
            ["ขาด 2 รอบขึ้นไป", overview.continuity.missMore, "text-destructive"],
          ] as const).map(([label, value, tone]) => <div key={label} className="flex flex-col rounded-lg bg-muted/60 px-3 py-2"><span className={cn("font-heading text-2xl font-bold tabular-nums", tone)}>{value.toLocaleString("th-TH")} <span className="text-sm font-semibold">คน</span></span><span className="text-xs text-muted-foreground">{label}</span></div>)}
        </div>
      </div>}
    </section>}

    {overview.days.length === 0 ? <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">ยังไม่ได้กำหนดวันที่จัด</p> : <section aria-label="ที่นั่งและการเช็คชื่อรายวัน" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {overview.days.map((day, index) => {
        const today = day.date.toISOString().slice(0, 10) === todayKey;
        const full = day.maxSeats !== null && day.occupied >= day.maxSeats;
        return <article key={day.id} className={cn("flex flex-col gap-4 rounded-xl border bg-card p-5", today && "border-2 border-primary p-[19px]")}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="flex items-baseline gap-2"><span className="font-heading text-xl font-bold">วันที่ {index + 1}</span><span className="text-sm text-muted-foreground">{formatEventDayWithWeekday(day.date)}</span></h3>
            {today ? <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">● วันนี้</span> : day.isClosed && seatMode === "per_day" ? <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">ปิดรับวันนี้</span> : null}
          </div>
          {seatMode === "per_day" ? <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm"><span className="text-muted-foreground">ที่นั่ง (อนุมัติแล้ว)</span><span className={cn("font-semibold tabular-nums", full && "text-destructive")}>{day.approved} / {day.maxSeats ?? "ไม่จำกัด"}{full ? ` เต็ม${day.waitlisted ? ` · คิว ${day.waitlisted}` : ""}` : ""}</span></div>
            <Meter value={day.approved} max={day.maxSeats} label={`ที่นั่งอนุมัติแล้ว ${day.approved} จาก ${day.maxSeats ?? "ไม่จำกัด"}`} tone={full ? "danger" : "ink"} />
            {day.occupied > day.approved && <span className="text-xs text-muted-foreground">รออนุมัติจองไว้อีก {day.occupied - day.approved} ที่</span>}
          </div> : <p className="text-sm text-muted-foreground">อนุมัติแล้ว {day.approved.toLocaleString("th-TH")} คน</p>}
          <div className="flex flex-col gap-3 border-t border-dashed pt-3">
            <h4 className="text-sm text-muted-foreground">เช็คชื่อตามรอบ</h4>
            {day.sessions.length ? day.sessions.map((session) => <SessionRow key={session.id} session={session} />) : <p className="text-sm text-muted-foreground">ยังไม่มีรอบเช็คชื่อของวันนี้</p>}
          </div>
        </article>;
      })}
      {overview.everyDaySessions.length > 0 && <article className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h3 className="font-heading text-lg font-bold">รอบที่ใช้ได้ทุกวัน</h3>
        {overview.everyDaySessions.map((session) => <SessionRow key={session.id} session={session} />)}
      </article>}
    </section>}
    <p className="text-xs text-muted-foreground">ตัวหารของแต่ละรอบ = ผู้อนุมัติแล้วของวันที่รอบนั้นผูกอยู่{seatMode === "whole_course" ? " (หลักสูตรต่อเนื่องใช้ผู้อนุมัติทั้งหลักสูตร)" : ""} · รอบที่ใช้ได้ทุกวันใช้ผู้อนุมัติทั้งโครงการ</p>
  </div>;
}
