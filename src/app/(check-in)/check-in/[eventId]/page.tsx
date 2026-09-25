import Link from "next/link";
import { ChevronLeftIcon, QrCodeIcon } from "lucide-react";

import { checkInPersonForm, undoCheckIn } from "@/app/(check-in)/check-in/[eventId]/actions";
import { Scanner } from "@/app/(check-in)/check-in/[eventId]/scanner";
import { SessionMemory } from "@/app/(check-in)/check-in/[eventId]/session-memory";
import { Button } from "@/components/ui/button";
import { AutoRefresh } from "@/components/auto-refresh";
import { Input } from "@/components/ui/input";
import { readRegistrationFields } from "@/features/events/registration-fields";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";

export default async function EventCheckInPage({ params, searchParams }: PageProps<"/check-in/[eventId]">) {
  const { eventId } = await params;
  const { session: sessionParam, q, result } = await searchParams;
  const { event, user } = await requireEventAccess(eventId, "checkIn");
  const checkinFields = readRegistrationFields(event.fields).filter((field) => field.showOnCheckin && !field.sensitive && field.type !== "file");
  const sessions = await db.session.findMany({ where: { eventId }, orderBy: [{ eventDay: { date: "asc" } }, { label: "asc" }], include: { eventDay: true, _count: { select: { checkIns: { where: { voidedAt: null } } } } } });
  const explicitSession = sessions.find((item) => item.id === sessionParam);
  const session = explicitSession ?? sessions[0];
  const dayLabel = (date: Date) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  const sessionLabels = Object.fromEntries(sessions.map((item) => [item.id, `${item.label} · ${item.eventDay ? dayLabel(item.eventDay.date) : "ทุกวัน"}`]));
  const query = typeof q === "string" ? q.trim().slice(0, 191) : "";
  const people = session && query.length >= 3 ? await db.registrant.findMany({
    where: { eventId, status: "APPROVED", OR: [{ email: { contains: query } }, ...checkinFields.filter((field) => ["text", "textarea", "email", "tel"].includes(field.type)).map((field) => ({ answers: { path: `$.${field.key}`, string_contains: query, mode: "insensitive" as const } }))], ...(session.eventDayId ? { days: { some: { eventDayId: session.eventDayId, status: "APPROVED" } } } : {}) },
    select: { id: true, email: true, answers: true, checkIns: { where: { sessionId: session.id, voidedAt: null }, select: { id: true } } }, take: 20,
  }) : [];
  const recent = session ? await db.checkIn.findMany({ where: { sessionId: session.id, voidedAt: null }, orderBy: { checkedInAt: "desc" }, take: 20, include: { registrant: { select: { email: true } } } }) : [];
  const mask = (email: string | null) => email ? `${email.slice(0, 2)}***${email.slice(email.indexOf("@"))}` : "ผู้เข้าร่วม";
  return <main className="checkin-screen mx-auto flex min-h-svh w-full max-w-lg flex-col gap-5 bg-background px-5 py-6 text-foreground">
    <AutoRefresh />
    <header className="flex items-center gap-3"><Button asChild variant="secondary" size="icon" aria-label="กลับไปโครงการทั้งหมด"><Link href="/check-in"><ChevronLeftIcon aria-hidden="true" /></Link></Button><div className="min-w-0 flex-1"><p className="truncate text-xs text-muted-foreground">เช็คชื่อหน้างาน</p><h1 className="truncate font-heading text-lg font-bold">{event.title}</h1></div><QrCodeIcon className="size-6 text-primary" aria-hidden="true" /></header>
    <nav aria-label="เลือกรอบเช็คชื่อ" className="flex flex-wrap gap-2 rounded-xl border bg-card p-3">{sessions.map((item) => <Button key={item.id} asChild variant={item.id === session?.id ? "default" : "outline"} size="sm"><Link href={`?session=${item.id}`}>{sessionLabels[item.id]} · {item._count.checkIns}</Link></Button>)}</nav>
    {session ? <>
      <SessionMemory eventId={eventId} sessionId={session.id} sessionIds={sessions.map((item) => item.id)} explicit={!!explicitSession} />
      <div className="sticky top-0 z-10 -mx-5 flex items-center justify-between gap-3 border-y bg-background/95 px-5 py-3 backdrop-blur" aria-live="polite">
        <div className="flex min-w-0 flex-col"><span className="text-xs text-muted-foreground">กำลังเช็คชื่อรอบ</span><strong className="truncate font-heading text-2xl">{session.label}</strong><span className="text-sm text-muted-foreground">{session.eventDay ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "UTC" }).format(session.eventDay.date) : "ใช้ได้ทุกวัน"}</span></div>
        <strong className="shrink-0 font-heading text-xl text-primary">{session._count.checkIns} คน</strong>
      </div>
      <Scanner key={session.id} eventId={eventId} sessionId={session.id} operatorId={user.id} sessionLabels={sessionLabels} />
      {result && <p role="status" className="rounded-lg border bg-card p-3 text-sm">{result === "success" ? "เช็คชื่อสำเร็จ" : result === "duplicate" ? "เช็คชื่อรอบนี้ไปแล้ว" : result === "wrong-day" ? "ไม่ได้ลงทะเบียนวันที่ของรอบนี้" : "เช็คชื่อไม่ได้ กรุณาตรวจข้อมูลอีกครั้ง"}</p>}
      <section className="rounded-xl border bg-card p-5"><h2 className="font-heading text-lg font-semibold">ค้นหาผู้เข้าร่วม</h2><form className="mt-3 flex gap-2"><input type="hidden" name="session" value={session.id} /><Input name="q" defaultValue={query} aria-label="ค้นหาด้วยอีเมลหรือฟิลด์ที่อนุญาต" placeholder="อีเมลหรือชื่ออย่างน้อย 3 ตัวอักษร" /><Button type="submit">ค้นหา</Button></form>
        {people.map((person) => {
          const answers = person.answers && typeof person.answers === "object" && !Array.isArray(person.answers) ? person.answers as Record<string, unknown> : {};
          return <div key={person.id} className="mt-3 flex items-center justify-between gap-2 border-t pt-3"><div className="flex flex-col gap-1"><span>{mask(person.email)}</span>{checkinFields.map((field) => <span key={field.key} className="text-xs text-muted-foreground">{field.label}: {Array.isArray(answers[field.key]) ? (answers[field.key] as string[]).join(", ") : String(answers[field.key] ?? "—")}</span>)}</div>{person.checkIns.length ? <span className="text-sm text-muted-foreground">เช็คชื่อแล้ว</span> : <form action={checkInPersonForm.bind(null, eventId, session.id, person.id)}><Button type="submit" size="sm">เช็คชื่อ</Button></form>}</div>;
        })}
      </section>
      <section className="rounded-xl border bg-card p-5"><h2 className="font-heading text-lg font-semibold">เช็คชื่อล่าสุด ({session._count.checkIns})</h2>{recent.map((entry) => <div key={entry.id} className="mt-3 flex items-center justify-between gap-2 border-t pt-3 text-sm"><span>{mask(entry.registrant.email)} · {entry.checkedInAt.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })}</span><form action={undoCheckIn.bind(null, eventId, session.id, entry.registrantId)}><Button type="submit" size="sm" variant="ghost">ยกเลิก</Button></form></div>)}</section>
    </> : <p>ยังไม่มีรอบเช็คชื่อ</p>}
  </main>;
}
