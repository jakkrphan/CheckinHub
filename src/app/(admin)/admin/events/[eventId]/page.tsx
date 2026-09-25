import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdminUser } from "@/server/authorization/session";
import { db } from "@/server/db";
import { DeleteEventButton } from "./delete-event-button";

const dateFormatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "UTC" });
const timeFormatter = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const statusLabel = { DRAFT: "ฉบับร่าง", PUBLISHED: "เผยแพร่แล้ว", CLOSED: "ปิดรับแล้ว" } as const;

export const metadata: Metadata = { title: "ดูแลโครงการ · ผู้ดูแลระบบ" };

export default async function AdminEventPage({ params }: PageProps<"/admin/events/[eventId]">) {
  const admin = await requireAdminUser();
  const { eventId } = await params;
  const event = await db.event.findUnique({
    where: { id: eventId },
    include: {
      owner: { select: { name: true, email: true } },
      sessions: { where: { eventDayId: null }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], include: { _count: { select: { checkIns: { where: { voidedAt: null } } } } } },
      days: { orderBy: { date: "asc" }, include: { sessions: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }], include: { _count: { select: { checkIns: { where: { voidedAt: null } } } } } }, _count: { select: { registrantDays: true } } } },
      organizers: { orderBy: { addedAt: "asc" }, include: { user: { select: { name: true, email: true } } } },
      _count: { select: { registrants: true } },
    },
  });
  if (!event) notFound();

  await db.auditLog.create({ data: {
    eventId: event.id,
    actorId: admin.id,
    action: "ADMIN_EVENT_VIEWED",
    target: event.id,
    metadata: { ownerId: event.ownerId },
  } });

  const statuses = await db.registrant.groupBy({ by: ["status"], where: { eventId: event.id }, _count: { _all: true } });
  const statusCounts = new Map(statuses.map((entry) => [entry.status, entry._count._all]));
  const auditLogs = await db.auditLog.findMany({
    where: { eventId: event.id }, orderBy: { createdAt: "desc" }, take: 30,
    include: { actor: { select: { name: true, email: true } } },
  });

  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 lg:px-10">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button asChild variant="outline" size="sm"><Link href="/admin?view=events">กลับไปโครงการทั้งหมด</Link></Button>
      <Badge variant="outline">ADMIN · จัดการระบบ</Badge>
      <div className="flex flex-wrap items-center gap-2">
        {!event.deletedAt && <Button asChild size="sm"><Link href={`/organizer/${event.id}`}>จัดการโครงการนี้</Link></Button>}
        {!event.deletedAt && <DeleteEventButton eventId={event.id} title={event.title} hasRegistrants={event._count.registrants > 0} />}
      </div>
    </div>
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2"><Badge variant={event.deletedAt ? "destructive" : event.status === "PUBLISHED" ? "default" : "secondary"}>{event.deletedAt ? "เก็บย้อนหลัง" : statusLabel[event.status]}</Badge><span className="text-sm text-muted-foreground">{event.eventType === "INTERNAL" ? "ภายใน" : event.eventType === "EXTERNAL" ? "ภายนอก" : "ผสม"}</span></div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">{event.title}</h1>
      <p className="text-sm text-muted-foreground">{event.slug} · {event.location || "ไม่ระบุสถานที่"}</p>
      <p className="text-sm">เจ้าของ: <span className="font-medium">{event.owner.name}</span> <span className="text-muted-foreground">({event.owner.email})</span></p>
    </header>

    <aside className="rounded-lg border border-amber-300/60 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
      การเปิดดูหน้านี้ถูกบันทึกใน audit log แล้ว บัญชีผู้ดูแลใช้เพื่อช่วยตรวจสอบเท่านั้น การแก้ไขการตั้งค่าและการลบยังเป็นสิทธิ์ของ owner
    </aside>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="สรุปโครงการ">
      {[ { label: "ผู้ลงทะเบียนทั้งหมด", count: event._count.registrants }, { label: "รออนุมัติ", count: statusCounts.get("PENDING") ?? 0 }, { label: "อนุมัติแล้ว", count: statusCounts.get("APPROVED") ?? 0 }, { label: "ปฏิเสธ", count: statusCounts.get("REJECTED") ?? 0 }, { label: "รอคิว", count: statusCounts.get("WAITLISTED") ?? 0 } ].map(({ label, count }) => <article key={label} className="rounded-xl border bg-card p-4">
        <div className="text-2xl font-bold tabular-nums">{count.toLocaleString("th-TH")}</div><div className="text-sm text-muted-foreground">{label}</div>
      </article>)}
    </section>

    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-xl font-semibold">วันจัดและรอบเช็คชื่อ</h2>
      {event.sessions.length > 0 && <article className="flex flex-col gap-3 rounded-xl border bg-card p-5"><h3 className="font-semibold">รอบที่ใช้ได้ทุกวัน</h3><div className="flex flex-wrap gap-2">{event.sessions.map((session) => <Badge key={session.id} variant="secondary">{session.label} · เช็คชื่อ {session._count.checkIns}</Badge>)}</div></article>}
      {event.days.length ? <div className="grid gap-4 lg:grid-cols-2">{event.days.map((day, index) => <article key={day.id} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">วันที่ {index + 1} · {dateFormatter.format(day.date)}</h3><span className="text-sm text-muted-foreground">ลงทะเบียน {day._count.registrantDays}{day.maxSeats === null ? " คน · ไม่จำกัดที่นั่ง" : ` / ${day.maxSeats} ที่นั่ง`}</span></div>
        {day.sessions.length ? <div className="flex flex-col divide-y">{day.sessions.map((session) => <div key={session.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <div><div className="font-medium">{session.label}</div><div className="text-xs text-muted-foreground">{session.startTime ? timeFormatter.format(session.startTime) : "--:--"}{session.endTime ? `–${timeFormatter.format(session.endTime)}` : ""}</div></div>
          <Badge variant="secondary">เช็คชื่อ {session._count.checkIns}</Badge>
        </div>)}</div> : <p className="text-sm text-muted-foreground">ยังไม่ได้กำหนดรอบเช็คชื่อ</p>}
      </article>)}</div> : <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">ยังไม่ได้กำหนดวันจัด</p>}
    </section>

    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-xl font-semibold">ผู้ร่วมจัด</h2>
      <div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader className="bg-secondary"><TableRow><TableHead className="px-5">ชื่อ</TableHead><TableHead>อีเมล</TableHead><TableHead>สิทธิ์ในโครงการ</TableHead></TableRow></TableHeader><TableBody>
        {event.organizers.map((organizer) => <TableRow key={organizer.id}><TableCell className="px-5">{organizer.user.name}</TableCell><TableCell>{organizer.user.email}</TableCell><TableCell>{organizer.role === "FULL" ? "จัดการเต็มรูปแบบ" : "เช็คชื่อเท่านั้น"}</TableCell></TableRow>)}
        {event.organizers.length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-muted-foreground">ไม่มีผู้ร่วมจัดโครงการ</TableCell></TableRow>}
      </TableBody></Table></div>
    </section>

    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-xl font-semibold">Audit log ของโครงการ</h2>
      <div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader className="bg-secondary"><TableRow><TableHead className="min-w-40 px-5">เวลา</TableHead><TableHead>ผู้ดำเนินการ</TableHead><TableHead>กิจกรรม</TableHead><TableHead>เป้าหมาย</TableHead><TableHead>รายละเอียด</TableHead></TableRow></TableHeader><TableBody>
        {auditLogs.map((log) => <TableRow key={log.id}><TableCell className="px-5">{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(log.createdAt)}</TableCell><TableCell>{log.actor?.name ?? "ผู้ลงทะเบียน"}<div className="text-xs text-muted-foreground">{log.actor?.email ?? "ผ่านลิงก์สถานะส่วนตัว"}</div></TableCell><TableCell><code className="text-xs">{log.action}</code></TableCell><TableCell><code className="text-xs">{log.target ?? "—"}</code></TableCell><TableCell className="max-w-80 whitespace-normal text-xs">{log.metadata ? JSON.stringify(log.metadata) : "—"}</TableCell></TableRow>)}
        {auditLogs.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">ยังไม่มี audit log</TableCell></TableRow>}
      </TableBody></Table></div>
    </section>
  </main>;
}
