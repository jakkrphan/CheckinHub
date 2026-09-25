import Link from "next/link";
import { Prisma } from "@prisma/client";

import { approveSelected, decideRegistrant, decideRegistrantDay, reissueStatusLink } from "@/app/(organizer)/organizer/[eventId]/registrants/actions";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { readRegistrationFields } from "@/features/events/registration-fields";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";
import { OrganizerEventHeader } from "../event-header";

const labels = { PENDING: "รออนุมัติ", APPROVED: "อนุมัติแล้ว", REJECTED: "ปฏิเสธ", WAITLISTED: "คิวสำรอง", CANCELLED: "ยกเลิก" };

export default async function RegistrantsPage({ params, searchParams }: PageProps<"/organizer/[eventId]/registrants">) {
  const { eventId } = await params;
  const { q, status, result, day, field, answer, page, approved, requested } = await searchParams;
  const { event } = await requireEventAccess(eventId, "view");
  const query = typeof q === "string" ? q.trim().slice(0, 100) : "";
  const selectedStatus = typeof status === "string" && status in labels ? status as keyof typeof labels : undefined;
  const fields = readRegistrationFields(event.fields);
  const eventDays = await db.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true, date: true } });
  const selectedDay = typeof day === "string" && eventDays.some((item) => item.id === day) ? day : undefined;
  const selectedField = typeof field === "string" ? fields.find((item) => item.key === field && item.type !== "file") : undefined;
  const answerValue = typeof answer === "string" ? answer.trim().slice(0, 3000) : "";
  const currentPage = typeof page === "string" && /^\d+$/.test(page) ? Math.max(1, Math.min(100000, Number(page))) : 1;
  const pageSize = 100;
  const where: Prisma.RegistrantWhereInput = { eventId };
  if (selectedStatus && !selectedDay) where.status = selectedStatus;
  if (selectedDay) where.days = { some: { eventDayId: selectedDay, ...(selectedStatus ? { status: selectedStatus } : {}) } };
  if (query) {
    where.OR = [
      { email: { contains: query } },
      ...fields.filter((item) => ["text", "textarea", "email", "tel"].includes(item.type)).map((item) => ({ answers: { path: `$.${item.key}`, string_contains: query, mode: "insensitive" as const } })),
    ];
  }
  if (selectedField && answerValue) {
    const answerFilter = selectedField.type === "checkbox"
      ? { path: `$.${selectedField.key}`, array_contains: [answerValue] }
      : ["select", "date"].includes(selectedField.type)
        ? { path: `$.${selectedField.key}`, equals: answerValue }
        : { path: `$.${selectedField.key}`, string_contains: answerValue, mode: "insensitive" as const };
    where.AND = [...(where.AND ? Array.isArray(where.AND) ? where.AND : [where.AND] : []), { answers: answerFilter }];
  }
  const [registrants, total] = await Promise.all([db.registrant.findMany({
    where,
    orderBy: { registeredAt: "desc" },
    skip: (currentPage - 1) * pageSize,
    take: pageSize,
    include: { days: { orderBy: { eventDay: { date: "asc" } }, include: { eventDay: { select: { date: true } } } }, checkIns: { where: { voidedAt: null }, select: { sessionId: true } } },
  }), db.registrant.count({ where })]);
  const counts = await db.registrant.groupBy({ by: ["status"], where: { eventId }, _count: true });
  const sessions = await db.session.findMany({ where: { eventId }, orderBy: [{ eventDay: { date: "asc" } }, { sortOrder: "asc" }, { label: "asc" }], select: { id: true, label: true, eventDay: { select: { date: true } }, _count: { select: { checkIns: { where: { voidedAt: null } } } } } });
  const date = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "UTC" });
  const makeHref = (changes: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const current = { q: query || undefined, status: selectedStatus, day: selectedDay, field: selectedField?.key, answer: answerValue || undefined, page: String(currentPage), ...changes };
    for (const [key, value] of Object.entries(current)) if (value) params.set(key, value);
    return `?${params.toString()}`;
  };

  return <>
    <OrganizerEventHeader event={event} activeTab="registrants" actions={<><Button asChild><Link href={`/organizer/${eventId}/registrants/new`}>เพิ่มผู้สมัคร</Link></Button><form method="get" action={`/organizer/${eventId}/registrants/export`} className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-1 text-xs"><input type="checkbox" name="includeSensitive" className="size-4 accent-primary" />รวมข้อมูลอ่อนไหว</label><Button type="submit" variant="outline">ส่งออก CSV</Button><Button type="submit" name="format" value="xlsx" variant="outline">ส่งออก Excel (.xlsx)</Button></form></>} />
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 lg:px-10">
    <AutoRefresh />
    <h2 className="font-heading text-xl font-semibold">ผู้ลงทะเบียน</h2>
    {event.anonymizedAt && <p role="status" className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">ข้อมูลส่วนบุคคลของโครงการนี้ถูกปกปิดแล้วเมื่อครบระยะเก็บข้อมูล {new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(event.anonymizedAt)} เหลือเฉพาะสถานะและสถิติการเข้าร่วม</p>}
    <div className="flex flex-wrap gap-2"><Badge variant={!selectedStatus ? "default" : "outline"}><Link href={makeHref({ status: undefined, page: "1" })}>ทั้งหมด {counts.reduce((sum, item) => sum + item._count, 0)}</Link></Badge>{Object.entries(labels).map(([key, label]) => <Badge key={key} variant={selectedStatus === key ? "default" : "outline"}><Link href={makeHref({ status: key, page: "1" })}>{label} {counts.find((item) => item.status === key)?._count ?? 0}</Link></Badge>)}</div>
    <div className="rounded-xl border bg-card p-4"><p className="font-medium">เช็คชื่อแต่ละรอบ</p><div className="mt-2 flex flex-wrap gap-3 text-sm">{sessions.map((session) => <span key={session.id}>{session.label} · {session.eventDay ? date.format(session.eventDay.date) : "ทุกวัน"}: {session._count.checkIns}</span>)}</div></div>
    <form method="get" className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      {selectedStatus && <input type="hidden" name="status" value={selectedStatus} />}
      <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field><FieldLabel htmlFor="registrant-search">ค้นหาอีเมลหรือคำตอบข้อความ</FieldLabel><Input id="registrant-search" name="q" type="search" defaultValue={query} maxLength={100} placeholder="ชื่อ / อีเมล" /></Field>
        <Field><FieldLabel htmlFor="registrant-day">วันที่เลือกเข้าร่วม</FieldLabel><NativeSelect id="registrant-day" name="day" defaultValue={selectedDay ?? ""}><option value="">ทุกวัน</option>{eventDays.map((item, index) => <option key={item.id} value={item.id}>วันที่ {index + 1} · {date.format(item.date)}</option>)}</NativeSelect></Field>
        <Field><FieldLabel htmlFor="registrant-answer-field">กรองตามคำตอบ</FieldLabel><NativeSelect id="registrant-answer-field" name="field" defaultValue={selectedField?.key ?? ""}><option value="">ไม่กรองคำตอบ</option>{fields.filter((item) => item.type !== "file").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</NativeSelect></Field>
        <Field><FieldLabel htmlFor="registrant-answer">ค่าคำตอบ</FieldLabel>{selectedField?.options?.length ? <NativeSelect id="registrant-answer" name="answer" defaultValue={answerValue}><option value="">ทุกค่า</option>{selectedField.options.map((option) => <option key={option} value={option}>{option}</option>)}</NativeSelect> : <Input id="registrant-answer" name="answer" type={selectedField?.type === "date" ? "date" : "search"} defaultValue={answerValue} maxLength={3000} disabled={!selectedField} placeholder={selectedField ? "พิมพ์ค่าที่ต้องการกรอง" : "เลือกฟิลด์ก่อน"} />}</Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">แสดง {total ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, total)} จาก {total.toLocaleString("th-TH")} คน</p><Button type="submit">ค้นหา / กรอง</Button></div>
    </form>
    {registrants.some((person) => person.status === "PENDING") && <form action={approveSelected.bind(null, eventId)} className="rounded-xl border bg-card p-4"><p className="font-medium">อนุมัติหลายคน</p><div className="mt-3 flex max-h-48 flex-col gap-2 overflow-auto text-sm">{registrants.filter((person) => person.status === "PENDING").map((person) => <label key={person.id} className="flex items-center gap-2"><input type="checkbox" name="registrantId" value={person.id} />{person.email}</label>)}</div><Button type="submit" size="sm" className="mt-3">อนุมัติที่เลือก</Button></form>}
    {result === "partial" && <p role="status" className="rounded-lg border bg-card p-4 text-sm">อนุมัติ {approved} จาก {requested} วัน วันที่ยังเต็มอยู่ในคิวสำรอง</p>}
    {result === "full" && <p role="status" className="rounded-lg border bg-card p-4 text-sm">วันที่เลือกยังเต็ม ผู้สมัครยังอยู่ในคิวสำรอง</p>}
    {result && !["updated", "partial", "full"].includes(String(result)) && <p role="alert" className="text-sm text-destructive">ทำรายการไม่ได้ ({result}) กรุณารีเฟรชแล้วลองใหม่</p>}
    {registrants.length === 0 && <p className="rounded-xl border p-6 text-muted-foreground">ยังไม่มีผู้ลงทะเบียนตามเงื่อนไขนี้</p>}
    {registrants.map((person) => {
      const answers = person.answers && typeof person.answers === "object" && !Array.isArray(person.answers) ? person.answers as Record<string, unknown> : {};
      return <article key={person.id} className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{person.email ?? "ไม่มีอีเมล"}</p><p className="text-sm text-muted-foreground">ลงทะเบียน {date.format(person.registeredAt)} · {person.days.map((day) => date.format(day.eventDay.date)).join(", ")}</p></div><Badge variant={person.status === "APPROVED" ? "default" : "secondary"}>{labels[person.status]}</Badge></div>
        {person.status === "REJECTED" && person.rejectReason && <p className="mt-2 text-sm text-muted-foreground">เหตุผลที่ปฏิเสธ: {person.rejectReason}</p>}
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{fields.map((field) => {
          const answer = answers[field.key];
          const file = field.type === "file" && answer && typeof answer === "object" && !Array.isArray(answer)
            ? answer as { originalName?: unknown } : null;
          return <div key={field.key}><dt className="text-muted-foreground">{field.label}</dt><dd>{field.sensitive && answer != null
            ? <Link className="underline underline-offset-2" href={`/organizer/${eventId}/registrants/${person.id}/sensitive/${field.key}`}>เปิดดูข้อมูลอ่อนไหว</Link>
            : file && typeof file.originalName === "string"
            ? <Link className="underline underline-offset-2" href={`/organizer/${eventId}/registrants/${person.id}/files/${field.key}`}>ดาวน์โหลด {file.originalName}</Link>
            : Array.isArray(answer) ? (answer as string[]).join(", ") : String(answer ?? "—")}</dd></div>;
        })}</dl>
        <div className="mt-4 space-y-2 border-t pt-4">
          <p className="text-sm font-semibold">สถานะรายวัน</p>
          {person.days.map((day) => <div key={day.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-32">{date.format(day.eventDay.date)}</span>
            <Badge variant={day.status === "APPROVED" ? "default" : "secondary"}>{labels[day.status]}</Badge>
            {event.seatMode !== "whole_course" && (day.status === "PENDING" || day.status === "WAITLISTED") && <form action={decideRegistrantDay.bind(null, eventId, person.id, day.eventDayId, "approve")}><Button size="sm" variant="outline">อนุมัติวันนี้</Button></form>}
            {event.seatMode !== "whole_course" && (day.status === "PENDING" || day.status === "WAITLISTED") && <form action={decideRegistrantDay.bind(null, eventId, person.id, day.eventDayId, "reject")}><Button size="sm" variant="outline">ปฏิเสธวันนี้</Button></form>}
            {event.seatMode !== "whole_course" && day.status === "APPROVED" && <form action={decideRegistrantDay.bind(null, eventId, person.id, day.eventDayId, "cancel")}><Button size="sm" variant="outline">ยกเลิกวันนี้</Button></form>}
          </div>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(person.status === "PENDING" || event.seatMode === "whole_course" && person.status === "WAITLISTED") && <form action={decideRegistrant.bind(null, eventId, person.id, "approve")}><Button size="sm">อนุมัติ</Button></form>}
          {(person.status === "PENDING" || person.status === "WAITLISTED") && <details className="rounded-md border px-3 py-1.5 text-sm">
            <summary className="cursor-pointer font-medium">ปฏิเสธ…</summary>
            <form action={decideRegistrant.bind(null, eventId, person.id, "reject")} className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs">เหตุผล (ไม่บังคับ แสดงในหน้าสถานะของผู้สมัคร)<input name="reason" maxLength={500} className="h-8 w-64 rounded-md border bg-background px-2 text-sm" /></label>
              <Button size="sm" variant="outline">ยืนยันปฏิเสธ</Button>
            </form>
          </details>}
          {person.status === "APPROVED" && <form action={decideRegistrant.bind(null, eventId, person.id, "cancel")}><Button size="sm" variant="destructive">ถอนการอนุมัติ</Button></form>}
          {person.status === "APPROVED" && <Button asChild size="sm" variant="outline"><a href={`/organizer/${eventId}/registrants/${person.id}/qr`}>ดาวน์โหลด QR เพื่อส่งเอง</a></Button>}
          <form action={reissueStatusLink.bind(null, eventId, person.id)} className="flex items-center gap-2"><label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" required />ยืนยันว่าลิงก์เดิมจะใช้ไม่ได้</label><Button type="submit" size="sm" variant="outline">ออกลิงก์สถานะใหม่</Button></form>
        </div>
      </article>;
    })}
    {(currentPage > 1 || currentPage * pageSize < total) && <nav aria-label="หน้ารายชื่อผู้ลงทะเบียน" className="flex items-center justify-between gap-3">
      {currentPage <= 1 ? <Button variant="outline" disabled>ก่อนหน้า</Button> : <Button asChild variant="outline"><Link href={makeHref({ page: String(currentPage - 1) })}>ก่อนหน้า</Link></Button>}
      <span className="text-sm text-muted-foreground">หน้า {currentPage} / {Math.max(1, Math.ceil(total / pageSize))}</span>
      {currentPage * pageSize >= total ? <Button variant="outline" disabled>ถัดไป</Button> : <Button asChild variant="outline"><Link href={makeHref({ page: String(currentPage + 1) })}>ถัดไป</Link></Button>}
    </nav>}
  </main>;
  </>;
}
