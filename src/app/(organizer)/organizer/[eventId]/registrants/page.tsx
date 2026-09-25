import Link from "next/link";
import { Prisma, type RegistrantStatus } from "@prisma/client";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, FileIcon, LinkIcon, LockIcon, QrCodeIcon, SearchIcon, TriangleAlertIcon, UserPlusIcon, XIcon } from "lucide-react";

import { approveSelected, decideRegistrant, decideRegistrantDay, reissueStatusLink } from "@/app/(organizer)/organizer/[eventId]/registrants/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { readRegistrationFields, type RegistrationFieldConfig } from "@/features/events/registration-fields";
import { formatDateTime, formatEventDay, formatEventDayWithWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";

import { OrganizerEventHeader } from "../event-header";
import { BulkSelectForm } from "./bulk-select";

const labels: Record<RegistrantStatus, string> = { PENDING: "รออนุมัติ", WAITLISTED: "รอคิว", APPROVED: "อนุมัติ", REJECTED: "ปฏิเสธ", CANCELLED: "ยกเลิก" };
const statusOrder: RegistrantStatus[] = ["PENDING", "WAITLISTED", "APPROVED", "REJECTED", "CANCELLED"];
const chipTone: Record<RegistrantStatus, string> = {
  PENDING: "border-amber-300 bg-amber-50 text-amber-900",
  WAITLISTED: "border-orange-300 bg-orange-50 text-orange-900",
  APPROVED: "border-primary/40 bg-accent text-accent-foreground",
  REJECTED: "border-border bg-muted text-muted-foreground line-through",
  CANCELLED: "border-border bg-muted text-muted-foreground line-through",
};
const resultMessages: Record<string, [string, "ok" | "warn" | "error"]> = {
  updated: ["บันทึกการตัดสินใจแล้ว", "ok"],
  partial: ["อนุมัติบางวันแล้ว วันที่เต็มยังอยู่ในคิวสำรอง", "warn"],
  full: ["ที่นั่งยังเต็ม ผู้สมัครยังอยู่ในคิวสำรอง", "warn"],
  invalid: ["ทำรายการนี้ไม่ได้ สถานะอาจเปลี่ยนไปแล้ว กรุณาตรวจอีกครั้ง", "error"],
  missing: ["ไม่พบผู้ลงทะเบียนนี้", "error"],
  retry: ["ระบบกำลังทำรายการอื่นพร้อมกัน กรุณาลองใหม่", "error"],
  confirm: ["กรุณาติ๊กยืนยันก่อนออกลิงก์สถานะใหม่", "error"],
};

/** The best human name for a registrant: the first text field that looks like a name, else their email. */
function displayName(fields: RegistrationFieldConfig[], answers: Record<string, unknown>, email: string | null) {
  const nameField = fields.find((field) => field.type === "text" && !field.sensitive && (/ชื่อ|name/i.test(field.label) || /name/i.test(field.key)));
  const value = nameField ? answers[nameField.key] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : email ?? "ไม่มีชื่อ (ข้อมูลถูกปกปิด)";
}

function asAnswers(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export default async function RegistrantsPage({ params, searchParams }: PageProps<"/organizer/[eventId]/registrants">) {
  const { eventId } = await params;
  const search = await searchParams;
  const { event } = await requireEventAccess(eventId, "view");
  const query = typeof search.q === "string" ? search.q.trim().slice(0, 100) : "";
  const selectedStatus = typeof search.status === "string" && search.status in labels ? search.status as RegistrantStatus : undefined;
  const fields = readRegistrationFields(event.fields);
  const eventDays = await db.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true, date: true } });
  const dayIndex = new Map(eventDays.map((day, index) => [day.id, index + 1]));
  const selectedDay = typeof search.day === "string" && eventDays.some((item) => item.id === search.day) ? search.day : undefined;
  const selectedField = typeof search.field === "string" ? fields.find((item) => item.key === search.field && item.type !== "file" && !item.sensitive) : undefined;
  const answerValue = typeof search.answer === "string" ? search.answer.trim().slice(0, 3000) : "";
  const currentPage = typeof search.page === "string" && /^\d+$/.test(search.page) ? Math.max(1, Math.min(100000, Number(search.page))) : 1;
  const pageSize = 50;

  const where: Prisma.RegistrantWhereInput = { eventId };
  if (selectedStatus && !selectedDay) where.status = selectedStatus;
  if (selectedDay) where.days = { some: { eventDayId: selectedDay, ...(selectedStatus ? { status: selectedStatus } : {}) } };
  if (query) {
    where.OR = [
      { email: { contains: query } },
      ...fields.filter((item) => ["text", "textarea", "email", "tel"].includes(item.type) && !item.sensitive).map((item) => ({ answers: { path: `$.${item.key}`, string_contains: query, mode: "insensitive" as const } })),
    ];
  }
  if (selectedField && answerValue) {
    const answerFilter = selectedField.type === "checkbox"
      ? { path: `$.${selectedField.key}`, array_contains: [answerValue] }
      : ["select", "date"].includes(selectedField.type)
        ? { path: `$.${selectedField.key}`, equals: answerValue }
        : { path: `$.${selectedField.key}`, string_contains: answerValue, mode: "insensitive" as const };
    where.AND = [{ answers: answerFilter }];
  }

  const [registrants, total, counts] = await Promise.all([
    db.registrant.findMany({
      where, orderBy: [{ registeredAt: "desc" }, { id: "desc" }], skip: (currentPage - 1) * pageSize, take: pageSize,
      select: { id: true, email: true, answers: true, status: true, registeredAt: true, days: { select: { eventDayId: true, status: true } } },
    }),
    db.registrant.count({ where }),
    db.registrant.groupBy({ by: ["status"], where: { eventId }, _count: true }),
  ]);
  const countOf = (status: RegistrantStatus) => counts.find((item) => item.status === status)?._count ?? 0;
  const allCount = counts.reduce((sum, item) => sum + item._count, 0);

  const filterParams = { q: query || undefined, status: selectedStatus, day: selectedDay, field: selectedField?.key, answer: answerValue || undefined, page: currentPage > 1 ? String(currentPage) : undefined };
  const makeHref = (changes: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filterParams, ...changes })) if (value) params.set(key, value);
    const text = params.toString();
    return `/organizer/${eventId}/registrants${text ? `?${text}` : ""}`;
  };

  const requestedSelection = typeof search.selected === "string" ? search.selected : undefined;
  const selectedId = requestedSelection ?? registrants[0]?.id;
  const person = selectedId ? await db.registrant.findFirst({
    where: { id: selectedId, eventId },
    include: {
      days: { orderBy: { eventDay: { date: "asc" } }, include: { eventDay: { select: { date: true, maxSeats: true } } } },
      checkIns: { where: { voidedAt: null }, orderBy: { checkedInAt: "asc" }, select: { id: true, checkedInAt: true, isOverride: true, session: { select: { label: true, eventDay: { select: { date: true } } } } } },
    },
  }) : null;
  const queuePositions = person ? new Map(await Promise.all(person.days.filter((day) => day.status === "WAITLISTED" && day.waitlistedAt).map(async (day) => [day.id,
    event.seatMode === "whole_course"
      ? await db.registrant.count({ where: { eventId, status: "WAITLISTED", OR: [{ registeredAt: { lt: person.registeredAt } }, { registeredAt: person.registeredAt, id: { lte: person.id } }] } })
      : await db.registrantEventDay.count({ where: { eventDayId: day.eventDayId, status: "WAITLISTED", OR: [{ waitlistedAt: { lt: day.waitlistedAt! } }, { waitlistedAt: day.waitlistedAt!, id: { lte: day.id } }] } }),
  ] as const))) : new Map<string, number>();
  const positionInList = person ? registrants.findIndex((item) => item.id === person.id) : -1;
  const previous = positionInList > 0 ? registrants[positionInList - 1] : undefined;
  const next = positionInList >= 0 && positionInList < registrants.length - 1 ? registrants[positionInList + 1] : undefined;
  const returnTo = makeHref({ selected: person?.id });
  const result = typeof search.result === "string" ? resultMessages[search.result] : undefined;
  const personAnswers = asAnswers(person?.answers);
  const canEdit = !event.anonymizedAt;
  const hasFilters = !!(query || selectedDay || (selectedField && answerValue));

  return <>
    <OrganizerEventHeader event={event} activeTab="registrants" actions={<>
      <form method="get" action={`/organizer/${eventId}/registrants/export`} className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" name="includeSensitive" className="size-4 accent-primary" />รวมข้อมูลอ่อนไหว</label>
        <Button type="submit" variant="outline"><DownloadIcon data-icon="inline-start" aria-hidden="true" />Export CSV</Button>
        <Button type="submit" name="format" value="xlsx" variant="outline">Excel</Button>
      </form>
    </>} />
    <AutoRefresh intervalMs={5000} />
    {event.anonymizedAt && <p role="status" className="mx-auto mt-4 w-full max-w-7xl rounded-xl border bg-card px-5 py-3 text-sm text-muted-foreground lg:px-10">ข้อมูลส่วนบุคคลของโครงการนี้ถูกปกปิดแล้วเมื่อครบระยะเก็บข้อมูล {formatEventDay(event.anonymizedAt)} เหลือเฉพาะสถานะและสถิติ</p>}

    <div className="grid flex-1 lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]">
      {/* Master list */}
      <section aria-label="รายชื่อผู้ลงทะเบียน" className={cn("flex min-w-0 flex-col border-r bg-card lg:sticky lg:top-0 lg:h-[calc(100svh-15rem)] lg:min-h-[28rem] lg:overflow-hidden", person && requestedSelection && "hidden lg:flex")}>
        <div className="flex flex-col gap-3 border-b p-4">
          <nav aria-label="กรองตามสถานะ" className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
            {[{ key: undefined, label: "ทั้งหมด", count: allCount }, ...statusOrder.map((key) => ({ key, label: labels[key], count: countOf(key) }))].map((tab) => (
              <Link key={tab.label} href={makeHref({ status: tab.key, page: undefined, selected: undefined })} aria-current={selectedStatus === tab.key ? "page" : undefined}
                className={cn("shrink-0 rounded-md px-2.5 py-1.5 text-sm", selectedStatus === tab.key ? "bg-card font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground")}>{tab.label} <span className="tabular-nums">{tab.count}</span></Link>
            ))}
          </nav>
          <form method="get" role="search" className="flex flex-col gap-2">
            {selectedStatus && <input type="hidden" name="status" value={selectedStatus} />}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <label htmlFor="registrant-search" className="sr-only">ค้นหาชื่อหรืออีเมล</label>
                <Input id="registrant-search" name="q" type="search" defaultValue={query} maxLength={100} placeholder="ชื่อ / อีเมล" className="pl-9" />
              </div>
              <label htmlFor="registrant-day" className="sr-only">วันที่เข้าร่วม</label>
              <NativeSelect id="registrant-day" name="day" defaultValue={selectedDay ?? ""} className="w-28"><option value="">ทุกวัน</option>{eventDays.map((item, index) => <option key={item.id} value={item.id}>วันที่ {index + 1}</option>)}</NativeSelect>
            </div>
            <div className="flex gap-2">
              <label htmlFor="registrant-answer-field" className="sr-only">กรองตามคำตอบของฟิลด์</label>
              <NativeSelect id="registrant-answer-field" name="field" defaultValue={selectedField?.key ?? ""} className="min-w-0 flex-1"><option value="">กรองตามคำตอบ…</option>{fields.filter((item) => item.type !== "file" && !item.sensitive).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</NativeSelect>
              <label htmlFor="registrant-answer" className="sr-only">ค่าคำตอบ</label>
              {selectedField?.options?.length
                ? <NativeSelect id="registrant-answer" name="answer" defaultValue={answerValue} className="min-w-0 flex-1"><option value="">ทุกค่า</option>{selectedField.options.map((option) => <option key={option} value={option}>{option}</option>)}</NativeSelect>
                : <Input id="registrant-answer" name="answer" type={selectedField?.type === "date" ? "date" : "search"} defaultValue={answerValue} maxLength={3000} disabled={!selectedField} placeholder={selectedField ? "ค่าที่ต้องการ" : "เลือกฟิลด์ก่อน"} className="min-w-0 flex-1" />}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">พบ {total.toLocaleString("th-TH")} คน</span>
              <div className="flex gap-2">{hasFilters && <Button asChild variant="ghost" size="sm"><Link href={makeHref({ q: undefined, day: undefined, field: undefined, answer: undefined, page: undefined, selected: undefined })}><XIcon data-icon="inline-start" aria-hidden="true" />ล้างตัวกรอง</Link></Button>}<Button type="submit" size="sm" variant="outline">ค้นหา</Button></div>
            </div>
          </form>
        </div>

        <BulkSelectForm action={approveSelected.bind(null, eventId)} selectable={canEdit ? registrants.filter((item) => item.status === "PENDING").length : 0}>
          <input type="hidden" name="returnTo" value={makeHref({})} />
          {registrants.length === 0 ? <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{allCount ? "ไม่พบผู้ลงทะเบียนตามเงื่อนไขนี้" : "ยังไม่มีผู้ลงทะเบียน"}</p>
            <p>{allCount ? "ลองล้างตัวกรองหรือเปลี่ยนแท็บสถานะ" : "แชร์ลิงก์ลงทะเบียน หรือเพิ่มผู้ลงทะเบียนเองได้จากปุ่มด้านขวา"}</p>
          </div> : <ul className="divide-y">{registrants.map((item) => {
            const active = item.id === person?.id;
            const name = displayName(fields, asAnswers(item.answers), item.email);
            return <li key={item.id} className={cn("relative flex items-start gap-3 px-4 py-3 hover:bg-muted/50", active && "bg-accent/60 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary")}>
              {canEdit && item.status === "PENDING" ? <input type="checkbox" name="registrantId" value={item.id} aria-label={`เลือก ${name}`} className="relative z-10 mt-1 size-5 shrink-0 accent-primary" /> : <span className="w-5 shrink-0" aria-hidden="true" />}
              <Link href={makeHref({ selected: item.id })} aria-current={active ? "true" : undefined} className="flex min-w-0 flex-1 flex-col gap-1 outline-none after:absolute after:inset-0 focus-visible:underline">
                <span className="flex items-baseline justify-between gap-2"><span className="truncate font-semibold">{name}</span><span className="shrink-0 text-xs text-muted-foreground">{formatEventDay(item.registeredAt)}</span></span>
                <span className="truncate text-xs text-muted-foreground">{item.email ?? "—"}</span>
                <span className="flex flex-wrap gap-1">{item.days.sort((a, b) => (dayIndex.get(a.eventDayId) ?? 0) - (dayIndex.get(b.eventDayId) ?? 0)).map((day) => <span key={day.eventDayId} title={`วันที่ ${dayIndex.get(day.eventDayId)}: ${labels[day.status]}`} className={cn("rounded border px-1.5 text-[11px] font-semibold", chipTone[day.status])}>ว.{dayIndex.get(day.eventDayId)}</span>)}
                  {event.seatMode === "whole_course" && <span className={cn("rounded border px-1.5 text-[11px] font-semibold", chipTone[item.status])}>{labels[item.status]}</span>}</span>
              </Link>
            </li>;
          })}</ul>}
          {(currentPage > 1 || currentPage * pageSize < total) && <nav aria-label="หน้ารายชื่อ" className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm">
            {currentPage > 1 ? <Link className="underline-offset-4 hover:underline" href={makeHref({ page: String(currentPage - 1), selected: undefined })}>← ก่อนหน้า</Link> : <span />}
            <span className="text-muted-foreground">หน้า {currentPage} / {Math.max(1, Math.ceil(total / pageSize))}</span>
            {currentPage * pageSize < total ? <Link className="underline-offset-4 hover:underline" href={makeHref({ page: String(currentPage + 1), selected: undefined })}>ถัดไป →</Link> : <span />}
          </nav>}
        </BulkSelectForm>
      </section>

      {/* Detail */}
      <section aria-label="รายละเอียดผู้ลงทะเบียน" className={cn("flex min-w-0 flex-col bg-background", !(person && requestedSelection) && "hidden lg:flex")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-5 py-3">
          <div className="flex items-center gap-2">
            {requestedSelection && <Button asChild variant="ghost" size="sm" className="lg:hidden"><Link href={makeHref({ selected: undefined })}><ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />รายชื่อ</Link></Button>}
            {canEdit && <Button asChild variant="outline" size="sm"><Link href={`/organizer/${eventId}/registrants/new`}><UserPlusIcon data-icon="inline-start" aria-hidden="true" />เพิ่มผู้ลงทะเบียนเอง</Link></Button>}
          </div>
          <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />อัปเดตอัตโนมัติทุก 5 วินาที</span>
        </div>

        {result && <p role={result[1] === "error" ? "alert" : "status"} className={cn("mx-5 mt-4 rounded-lg border px-4 py-3 text-sm", result[1] === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : result[1] === "warn" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-primary/30 bg-accent text-accent-foreground")}>{result[0]}{search.result === "partial" && typeof search.approved === "string" && typeof search.requested === "string" ? ` (อนุมัติ ${search.approved} จาก ${search.requested} วัน)` : ""}</p>}

        {!person ? <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">เลือกผู้ลงทะเบียนจากรายชื่อเพื่อดูรายละเอียดและอนุมัติ</div> : <>
          <article className="flex flex-1 flex-col gap-5 px-5 py-6 lg:px-8">
            <header className="flex flex-col gap-2">
              <h2 className="font-heading text-2xl font-bold">{displayName(fields, personAnswers, person.email)}</h2>
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className={cn("rounded-md border px-2 py-0.5 text-xs font-semibold", chipTone[person.status])}>{labels[person.status]}{person.status === "WAITLISTED" && queuePositions.size ? ` · ลำดับ ${Math.min(...queuePositions.values())}` : ""}</span>
                ลงทะเบียน {formatDateTime(person.registeredAt)}{person.anonymizedAt ? " · ข้อมูลถูกปกปิดแล้ว" : ""}
              </p>
            </header>
            {person.status === "WAITLISTED" && <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"><TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{event.seatMode === "whole_course" ? "เข้าคิวเพราะที่นั่งทั้งหลักสูตรเต็ม" : `เข้าคิวเพราะ ${person.days.filter((day) => day.status === "WAITLISTED").map((day) => `วันที่ ${dayIndex.get(day.eventDayId)} เต็ม`).join(", ")}`} ตอนส่งใบสมัคร — เมื่อมีคนยกเลิก ระบบ{event.waitlistPromotion === "AUTO" ? "เลื่อนคิวให้อัตโนมัติ" : "แจ้งให้ผู้จัดเลือกเลื่อนคิวเอง"} หรืออนุมัติทับคิวได้เลย</p>}
            {person.status === "REJECTED" && person.rejectReason && <p className="rounded-lg border bg-card px-4 py-3 text-sm">เหตุผลที่ปฏิเสธ: {person.rejectReason}</p>}

            <dl className="grid grid-cols-1 border-t sm:grid-cols-[180px_minmax(0,1fr)]">
              <dt className="border-b py-3 text-sm text-muted-foreground">วันที่เลือก</dt>
              <dd className="flex flex-col gap-2 border-b py-3">{person.days.map((day) => <div key={day.id} className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-md border px-2 py-0.5 text-xs font-semibold", chipTone[day.status])}>วันที่ {dayIndex.get(day.eventDayId)} · {formatEventDayWithWeekday(day.eventDay.date)}</span>
                <span className="text-xs text-muted-foreground">{labels[day.status]}{queuePositions.has(day.id) ? ` · คิวที่ ${queuePositions.get(day.id)}` : ""}</span>
                {canEdit && event.seatMode !== "whole_course" && <span className="flex flex-wrap gap-1">
                  {(day.status === "PENDING" || day.status === "WAITLISTED") && <form action={decideRegistrantDay.bind(null, eventId, person.id, day.eventDayId, "approve")}><input type="hidden" name="returnTo" value={returnTo} /><Button size="xs" variant="outline">อนุมัติวันนี้</Button></form>}
                  {(day.status === "PENDING" || day.status === "WAITLISTED") && <form action={decideRegistrantDay.bind(null, eventId, person.id, day.eventDayId, "reject")}><input type="hidden" name="returnTo" value={returnTo} /><Button size="xs" variant="ghost">ปฏิเสธวันนี้</Button></form>}
                  {day.status === "APPROVED" && person.days.filter((item) => item.status === "APPROVED").length > 1 && <form action={decideRegistrantDay.bind(null, eventId, person.id, day.eventDayId, "cancel")}><input type="hidden" name="returnTo" value={returnTo} /><Button size="xs" variant="ghost">ยกเลิกวันนี้</Button></form>}
                </span>}
              </div>)}</dd>
              <dt className="border-b py-3 text-sm text-muted-foreground">อีเมล</dt>
              <dd className="border-b py-3 break-all">{person.email ?? "—"}</dd>
              {fields.map((field) => {
                const answer = personAnswers[field.key];
                const file = field.type === "file" && answer && typeof answer === "object" && !Array.isArray(answer) ? answer as { originalName?: unknown; size?: unknown } : null;
                return <div key={field.key} className="contents">
                  <dt className="border-b py-3 text-sm text-muted-foreground">{field.label}</dt>
                  <dd className="border-b py-3">{answer == null || answer === "" ? <span className="text-muted-foreground">{field.conditional ? "— (ไม่เข้าเงื่อนไข)" : "—"}</span>
                    : field.sensitive ? <Link className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4" href={`/organizer/${eventId}/registrants/${person.id}/sensitive/${field.key}`}><LockIcon className="size-4" aria-hidden="true" />เปิดดูข้อมูลอ่อนไหว (บันทึก audit)</Link>
                    : file && typeof file.originalName === "string" ? <Link className="inline-flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm font-medium hover:bg-muted/70" href={`/organizer/${eventId}/registrants/${person.id}/files/${field.key}`}><FileIcon className="size-4" aria-hidden="true" />{file.originalName}{typeof file.size === "number" ? <span className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span> : null}</Link>
                    : <span className="whitespace-pre-wrap">{Array.isArray(answer) ? (answer as string[]).join(", ") : String(answer)}</span>}
                    {field.conditional && answer != null && answer !== "" && <span className="ml-1 text-xs text-muted-foreground">(ฟิลด์เงื่อนไข)</span>}
                  </dd>
                </div>;
              })}
              <dt className="py-3 text-sm text-muted-foreground">เช็คชื่อแล้ว</dt>
              <dd className="py-3">{person.checkIns.length ? <ul className="flex flex-col gap-1 text-sm">{person.checkIns.map((checkIn) => <li key={checkIn.id}>{checkIn.session.label}{checkIn.session.eventDay ? ` · ${formatEventDay(checkIn.session.eventDay.date)}` : ""} <span className="text-muted-foreground">({formatDateTime(checkIn.checkedInAt)}){checkIn.isOverride ? " · กรณีพิเศษ" : ""}</span></li>)}</ul> : <span className="text-muted-foreground">ยังไม่มี</span>}</dd>
            </dl>
          </article>

          <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-card px-5 py-3">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              {previous ? <Button asChild variant="ghost" size="icon" aria-label="คนก่อนหน้า"><Link href={makeHref({ selected: previous.id })}><ChevronLeftIcon aria-hidden="true" /></Link></Button> : <span className="size-9" />}
              <span className="tabular-nums">{positionInList >= 0 ? `${(currentPage - 1) * pageSize + positionInList + 1} จาก ${total}` : ""}</span>
              {next ? <Button asChild variant="ghost" size="icon" aria-label="คนถัดไป"><Link href={makeHref({ selected: next.id })}><ChevronRightIcon aria-hidden="true" /></Link></Button> : <span className="size-9" />}
            </div>
            {canEdit && <div className="flex flex-wrap items-center justify-end gap-2">
              <details className="relative">
                <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted [&::-webkit-details-marker]:hidden"><LinkIcon className="size-4" aria-hidden="true" />ลิงก์สถานะ</summary>
                <form action={reissueStatusLink.bind(null, eventId, person.id)} className="absolute bottom-11 right-0 z-20 flex w-72 flex-col gap-2 rounded-xl border bg-card p-4 shadow-lg">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <p className="text-sm">ออกลิงก์สถานะใหม่เพื่อส่งให้ผู้สมัครเอง (ระหว่างยังไม่มีระบบส่งอีเมล)</p>
                  <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="confirm" required className="mt-0.5" />ยืนยันว่าลิงก์เดิมจะใช้ไม่ได้อีก</label>
                  <Button type="submit" size="sm" variant="outline">ออกลิงก์สถานะใหม่</Button>
                </form>
              </details>
              {person.status === "APPROVED" && <Button asChild variant="outline"><a href={`/organizer/${eventId}/registrants/${person.id}/qr`}><QrCodeIcon data-icon="inline-start" aria-hidden="true" />ดาวน์โหลด QR</a></Button>}
              {person.status === "APPROVED" && <form action={decideRegistrant.bind(null, eventId, person.id, "cancel")}><input type="hidden" name="returnTo" value={returnTo} /><Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">ยกเลิกการเข้าร่วม</Button></form>}
              {(person.status === "PENDING" || person.status === "WAITLISTED") && <details className="relative">
                <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border border-destructive/40 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 [&::-webkit-details-marker]:hidden">ปฏิเสธ…</summary>
                <form action={decideRegistrant.bind(null, eventId, person.id, "reject")} className="absolute bottom-11 right-0 z-20 flex w-72 flex-col gap-2 rounded-xl border bg-card p-4 shadow-lg">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <label className="flex flex-col gap-1 text-sm">เหตุผล (ไม่บังคับ · ผู้สมัครเห็นในหน้าสถานะ)<Input name="reason" maxLength={500} /></label>
                  <Button size="sm" variant="destructive">ยืนยันปฏิเสธ</Button>
                </form>
              </details>}
              {(person.status === "PENDING" || (event.seatMode === "whole_course" && person.status === "WAITLISTED")) && <form action={decideRegistrant.bind(null, eventId, person.id, "approve")}><input type="hidden" name="returnTo" value={returnTo} /><Button>อนุมัติ{person.status === "WAITLISTED" ? "ทับคิว" : ""}</Button></form>}
            </div>}
          </footer>
        </>}
      </section>
    </div>
  </>;
}
