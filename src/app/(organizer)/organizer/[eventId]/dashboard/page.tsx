import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";

import { OrganizerEventHeader } from "../event-header";

const statuses = [
  ["PENDING", "รออนุมัติ"], ["APPROVED", "อนุมัติแล้ว"], ["REJECTED", "ปฏิเสธ"], ["WAITLISTED", "รอคิว"], ["CANCELLED", "ยกเลิก / ถอนสิทธิ์"],
] as const;

export default async function DashboardPage({ params }: PageProps<"/organizer/[eventId]/dashboard">) {
  const { eventId } = await params;
  const { event } = await requireEventAccess(eventId, "view");
  const [counts, days, sessions, recent] = await Promise.all([
    db.registrant.groupBy({ by: ["status"], where: { eventId }, _count: true }),
    db.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true, date: true, maxSeats: true } }),
    db.session.findMany({ where: { eventId }, orderBy: { label: "asc" }, include: { eventDay: { select: { date: true } }, _count: { select: { checkIns: { where: { voidedAt: null } } } } } }),
    db.checkIn.findMany({ where: { session: { eventId }, voidedAt: null }, orderBy: { checkedInAt: "desc" }, take: 10, select: { id: true, checkedInAt: true, session: { select: { label: true, eventDay: { select: { date: true } } } } } }),
  ]);
  const date = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "UTC" });
  const dayStats = await Promise.all(days.map(async (day) => {
    const [occupied, approved, waitlisted] = await Promise.all([
      db.registrantEventDay.count({ where: { eventDayId: day.id, status: { in: ["PENDING", "APPROVED"] } } }),
      db.registrantEventDay.count({ where: { eventDayId: day.id, status: "APPROVED" } }),
      db.registrantEventDay.count({ where: { eventDayId: day.id, status: "WAITLISTED" } }),
    ]);
    return { ...day, occupied, approved, waitlisted };
  }));
  const approvedAcrossEvent = counts.find((item) => item.status === "APPROVED")?._count ?? 0;
  const courseTaken = event.seatMode === "whole_course" ? (counts.find((item) => item.status === "PENDING")?._count ?? 0) + approvedAcrossEvent : 0;
  const courseWaitlisted = counts.find((item) => item.status === "WAITLISTED")?._count ?? 0;
  const approvedPeople = event.seatMode === "whole_course" ? await db.registrant.findMany({ where: { eventId, status: "APPROVED" }, select: { id: true } }) : [];
  const attendance = approvedPeople.length ? await db.checkIn.groupBy({ by: ["registrantId"], where: { registrantId: { in: approvedPeople.map((person) => person.id) }, sessionId: { in: sessions.map((session) => session.id) }, voidedAt: null }, _count: true }) : [];
  const attendanceByPerson = new Map(attendance.map((item) => [item.registrantId, item._count]));
  const missed = approvedPeople.map((person) => Math.max(0, sessions.length - (attendanceByPerson.get(person.id) ?? 0)));
  const threshold = event.attendanceThreshold;
  const passed = threshold === null ? null : approvedPeople.filter((person) => sessions.length > 0 && (attendanceByPerson.get(person.id) ?? 0) / sessions.length * 100 >= threshold).length;

  return <>
    <OrganizerEventHeader event={event} activeTab="overview" />
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 lg:px-10">
      <AutoRefresh />
      {event.seatMode === "whole_course" && <section className="rounded-xl border bg-card p-5" aria-label="ที่นั่งและการเข้าอบรมทั้งหลักสูตร">
        <h2 className="font-heading text-lg font-semibold">หลักสูตรต่อเนื่อง</h2>
        <p className="mt-2 text-sm">จองแล้ว {courseTaken} / {event.maxSeats ?? "ไม่จำกัด"} ที่นั่ง · คิวสำรอง {courseWaitlisted} คน</p>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4"><span>เข้าครบทุกรอบ {missed.filter((count) => count === 0).length}</span><span>ขาด 1 รอบ {missed.filter((count) => count === 1).length}</span><span>ขาด 2 รอบขึ้นไป {missed.filter((count) => count >= 2).length}</span>{passed !== null && <span>ผ่านเกณฑ์ {threshold}%: {passed} คน</span>}</div>
      </section>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-heading text-xl font-semibold">ภาพรวมการลงทะเบียนและเช็คชื่อ</h2>
        <p className="text-xs text-muted-foreground">อัปเดตอัตโนมัติทุก 15 วินาที</p>
      </div>
      <section aria-label="สถานะผู้สมัคร" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {statuses.map(([status, label]) => <div key={status} className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 font-heading text-3xl font-bold tabular-nums">{counts.find((item) => item.status === status)?._count ?? 0}</p></div>)}
      </section>
      {dayStats.length > 0 && <section aria-label="สรุปที่นั่งและรอบเช็คชื่อ" className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {dayStats.map((day) => {
          const daySessions = sessions.filter((session) => !session.eventDay || session.eventDay.date.getTime() === day.date.getTime());
          const fill = day.maxSeats ? Math.min(100, Math.round(day.occupied / day.maxSeats * 100)) : null;
          return <article key={day.id} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
            <div className="flex items-start justify-between gap-3"><h3 className="font-heading text-lg font-semibold">{date.format(day.date)}</h3>{event.seatMode === "per_day" && <Badge variant={fill === 100 ? "destructive" : "secondary"}>{day.occupied} / {day.maxSeats ?? "ไม่จำกัด"} ที่นั่ง</Badge>}</div>
            {event.seatMode === "per_day" && fill !== null && <div className="flex flex-col gap-1"><div role="progressbar" aria-label={`ใช้ที่นั่ง ${day.occupied} จาก ${day.maxSeats}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${fill}%` }} /></div><span className="text-xs text-muted-foreground">{fill === 100 ? "เต็มแล้ว" : `เหลือ ${Math.max(0, day.maxSeats! - day.occupied)} ที่นั่ง`}</span></div>}
            <p className="text-sm text-muted-foreground">อนุมัติแล้ว {day.approved} คน · คิวสำรอง {day.waitlisted} คน</p>
            <div className="flex flex-col gap-2 border-t pt-3"><h4 className="text-sm font-semibold">เช็คชื่อตามรอบ</h4>{daySessions.length ? daySessions.map((session) => <div key={session.id} className="flex items-center justify-between gap-3 text-sm"><span>{session.label}</span><Badge variant="outline">{session._count.checkIns} / {session.eventDay ? day.approved : approvedAcrossEvent} คน</Badge></div>) : <p className="text-sm text-muted-foreground">ยังไม่มีรอบเช็คชื่อ</p>}</div>
          </article>;
        })}
      </section>}
      {dayStats.length === 0 && <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">ยังไม่ได้กำหนดวันที่จัดโครงการ</p>}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-heading text-lg font-semibold">เช็คชื่อล่าสุด</h2>
        <div className="mt-3 flex flex-col divide-y text-sm">{recent.length ? recent.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><span>{entry.session.label}{entry.session.eventDay ? ` · ${date.format(entry.session.eventDay.date)}` : ""}</span><time className="text-muted-foreground">{entry.checkedInAt.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</time></div>) : <p className="py-3 text-muted-foreground">ยังไม่มีการเช็คชื่อ</p>}</div>
      </section>
    </main>
  </>;
}
