import Link from "next/link";
import { CheckIcon, ChevronDownIcon, LayoutGridIcon, MapPinIcon, MonitorSmartphoneIcon, SearchIcon } from "lucide-react";

import { checkInPersonForm, correctCheckInAnswers, setCheckInStation, undoCheckIn } from "@/app/(check-in)/check-in/[eventId]/actions";
import { PopoverLink } from "@/app/(check-in)/check-in/[eventId]/popover-link";
import { Scanner } from "@/app/(check-in)/check-in/[eventId]/scanner";
import { SessionMemory } from "@/app/(check-in)/check-in/[eventId]/session-memory";
import { Button } from "@/components/ui/button";
import { AutoRefresh } from "@/components/auto-refresh";
import { LiveRefresh } from "@/components/live-refresh";
import { Input } from "@/components/ui/input";
import { readRegistrationFields } from "@/features/events/registration-fields";
import { cn } from "@/lib/utils";
import { requireEventAccess } from "@/server/authorization/event";
import { currentStation } from "@/server/checkin/station";
import { db } from "@/server/db";
import { getFeatureFlags } from "@/server/settings/features";

export default async function EventCheckInPage({ params, searchParams }: PageProps<"/check-in/[eventId]">) {
  const { eventId } = await params;
  const { session: sessionParam, q, result, corrected } = await searchParams;
  const { event, user } = await requireEventAccess(eventId, "checkIn");
  const checkinFields = readRegistrationFields(event.fields).filter((field) => field.showOnCheckin && !field.sensitive && field.type !== "file");
  const sessions = await db.session.findMany({ where: { eventId }, orderBy: [{ eventDay: { date: "asc" } }, { sortOrder: "asc" }, { label: "asc" }], include: { eventDay: true, _count: { select: { checkIns: { where: { voidedAt: null } } } } } });
  const explicitSession = sessions.find((item) => item.id === sessionParam);
  const session = explicitSession ?? sessions[0];
  const dayLabel = (date: Date) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  const sessionLabels = Object.fromEntries(sessions.map((item) => [item.id, `${item.label} · ${item.eventDay ? dayLabel(item.eventDay.date) : "ทุกวัน"}`]));
  const dayOrder = (await db.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true } })).map((day) => day.id);
  const approvedByDay = new Map((await db.registrantEventDay.groupBy({ by: ["eventDayId"], where: { eventDay: { eventId }, status: "APPROVED" }, _count: { _all: true } })).map((row) => [row.eventDayId, row._count._all]));
  const approvedTotal = await db.registrant.count({ where: { eventId, status: "APPROVED" } });
  const titleOf = (item: (typeof sessions)[number]) => item.eventDayId ? `วันที่ ${dayOrder.indexOf(item.eventDayId) + 1} · ${item.label}` : `ทุกวัน · ${item.label}`;
  const expectedOf = (item: (typeof sessions)[number]) => item.eventDayId ? approvedByDay.get(item.eventDayId) ?? 0 : approvedTotal;
  const query = typeof q === "string" ? q.trim().slice(0, 191) : "";
  const people = session && query.length >= 3 ? await db.registrant.findMany({
    where: { eventId, status: "APPROVED", OR: [{ email: { contains: query } }, ...checkinFields.filter((field) => ["text", "textarea", "email", "tel"].includes(field.type)).map((field) => ({ answers: { path: `$.${field.key}`, string_contains: query, mode: "insensitive" as const } }))], ...(session.eventDayId ? { days: { some: { eventDayId: session.eventDayId, status: "APPROVED" } } } : {}) },
    select: { id: true, email: true, answers: true, checkIns: { where: { sessionId: session.id, voidedAt: null }, select: { id: true } } }, take: 20,
  }) : [];
  const recent = session ? await db.checkIn.findMany({ where: { sessionId: session.id, voidedAt: null }, orderBy: { checkedInAt: "desc" }, take: 20, include: { registrant: { select: { email: true, answers: true } } } }) : [];
  const station = await currentStation();
  const flags = await getFeatureFlags();
  const mask = (email: string | null) => email ? `${email.slice(0, 2)}***${email.slice(email.indexOf("@"))}` : "ผู้เข้าร่วม";
  // Staff see the first check-in field (usually the name); the email stays masked.
  const nameOf = (person: { email: string | null; answers: unknown }) => {
    const answers = person.answers && typeof person.answers === "object" && !Array.isArray(person.answers) ? person.answers as Record<string, unknown> : {};
    const first = checkinFields.map((field) => answers[field.key]).find((value) => typeof value === "string" && value.trim());
    return typeof first === "string" ? first : mask(person.email);
  };
  const detailOf = (person: { answers: unknown }) => {
    const answers = person.answers && typeof person.answers === "object" && !Array.isArray(person.answers) ? person.answers as Record<string, unknown> : {};
    const second = checkinFields.slice(1).map((field) => answers[field.key]).find((value) => typeof value === "string" && value.trim());
    return typeof second === "string" ? second : "";
  };
  const checked = session?._count.checkIns ?? 0;
  const expected = session ? expectedOf(session) : 0;
  const sessionDate = session?.eventDay ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "UTC" }).format(session.eventDay.date) : "ใช้ได้ทุกวัน";

  // Light theme with a dark top bar on every screen size (phones match tablets/desktops); on desktop
  // a right column with the session total and the latest check-ins from every station.
  return <>
    {session ? <LiveRefresh url={`/check-in/${eventId}/state?session=${session.id}`} /> : <AutoRefresh />}
    <header className="checkin-dark bg-background text-foreground md:sticky md:top-0 md:z-20">
      <div className={cn("mx-auto flex w-full max-w-lg items-center gap-3 px-4 pt-4 md:max-w-4xl md:px-6 md:py-3 lg:max-w-7xl", "[@media(orientation:landscape)_and_(max-height:540px)]:max-w-4xl")}>
        <Button asChild variant="secondary" className="h-11 shrink-0 gap-1.5 px-3"><Link href="/check-in" aria-label="กลับไปเลือกโครงการ"><LayoutGridIcon aria-hidden="true" /><span className="max-[359px]:hidden">เลือกโครงการ</span></Link></Button>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs"><span className="flex items-center gap-1.5 text-primary"><span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />อัปเดตสด</span>{session && <><span className="text-muted-foreground">·</span><button type="button" popoverTarget="station-picker" className="-my-3.5 inline-flex min-h-11 items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"><MapPinIcon className="size-3" aria-hidden="true" />{station ? station : "ตั้งชื่อจุดเช็คชื่อ"}</button></>}</p>
          <h1 className="truncate font-heading text-base font-bold md:text-lg">{event.title}</h1>
        </div>
        {session && <button type="button" popoverTarget="session-picker" className="hidden shrink-0 items-center gap-3 rounded-xl border bg-card py-1.5 pl-4 pr-1.5 text-left md:flex">
          <span className="flex flex-col leading-tight"><span className="text-xs text-muted-foreground">รอบที่กำลังเช็ค</span><strong className="font-heading">{titleOf(session)}</strong></span>
          <span className="flex h-9 items-center gap-2 rounded-lg bg-muted px-3 text-sm font-semibold">เปลี่ยนรอบ<ChevronDownIcon className="size-4" aria-hidden="true" /></span>
        </button>}
        {session && <p className="hidden shrink-0 flex-col items-end leading-tight md:flex" aria-label={`เช็คแล้ว ${checked} จาก ${expected} คน`}><span><strong className="font-heading text-2xl">{checked}</strong><span className="text-muted-foreground"> / {expected}</span></span><span className="text-xs text-muted-foreground">เช็คแล้วในรอบนี้</span></p>}
        {flags.kiosk && session && <Button asChild variant="secondary" className="h-11"><Link href={`/check-in/${eventId}/kiosk?session=${session.id}`}><MonitorSmartphoneIcon data-icon="inline-start" aria-hidden="true" />kiosk</Link></Button>}
      </div>
    </header>
    {session ? <main className={cn("mx-auto grid w-full max-w-lg flex-1 grid-cols-1 content-start items-start gap-4 px-4 py-4 md:max-w-4xl md:px-6 md:py-6 lg:max-w-7xl lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]", "[@media(orientation:landscape)_and_(max-height:540px)]:max-w-4xl")}>
      <div className="flex min-w-0 flex-col gap-4">
        <button type="button" popoverTarget="session-picker" className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-left md:hidden">
          <span className="flex min-w-0 flex-col"><span className="text-xs text-muted-foreground">รอบที่กำลังเช็ค · แตะเพื่อเปลี่ยน</span><strong className="truncate font-heading text-xl">{titleOf(session)}</strong><span className="text-xs text-muted-foreground">{sessionDate}</span></span>
          <span className="flex shrink-0 items-center gap-1" aria-label={`เช็คแล้ว ${checked} จาก ${expected} คน`}><strong className="font-heading text-3xl">{checked}</strong><span className="text-sm text-muted-foreground">/{expected}</span><ChevronDownIcon className="ml-1 size-5 text-muted-foreground" aria-hidden="true" /></span>
        </button>
        <nav id="session-picker" popover="auto" aria-label="เลือกรอบเช็คชื่อ" className="m-auto w-[min(92vw,420px)] rounded-2xl border bg-card p-2 text-foreground shadow-2xl backdrop:bg-black/60">
          <p className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground">เลือกรอบเช็คชื่อ</p>
          <ul className="flex max-h-[70svh] flex-col overflow-y-auto">{sessions.map((item) => <li key={item.id}><PopoverLink href={`?session=${item.id}`} aria-current={item.id === session.id ? "true" : undefined} className={cn("flex min-h-12 items-center justify-between gap-3 rounded-lg px-3 py-2", item.id === session.id ? "bg-primary text-primary-foreground" : "hover:bg-muted/60")}>
            <span className="flex min-w-0 flex-col"><span className="truncate font-semibold">{titleOf(item)}</span><span className={cn("text-xs", item.id === session.id ? "text-primary-foreground/80" : "text-muted-foreground")}>{sessionLabels[item.id]}</span></span>
            <span className="shrink-0 font-heading font-bold">{item._count.checkIns}/{expectedOf(item)}</span>
          </PopoverLink></li>)}</ul>
        </nav>
        <SessionMemory eventId={eventId} sessionId={session.id} sessionIds={sessions.map((item) => item.id)} explicit={!!explicitSession} />
        {/* Station name per device (cookie): recorded with every check-in and shown in "เช็คล่าสุด (ทุกจุด)". */}
        <form id="station-picker" popover="auto" action={setCheckInStation.bind(null, eventId, session.id)} className="m-auto open:flex w-[min(92vw,380px)] flex-col gap-3 rounded-2xl border bg-card p-5 text-foreground shadow-2xl backdrop:bg-black/50">
          <label htmlFor="station-name" className="font-heading text-lg font-bold">จุดเช็คชื่อของเครื่องนี้</label>
          <p className="text-sm text-muted-foreground">ใช้แยกว่าใครเช็คจากจุดไหน เช่น โต๊ะหน้าห้อง หรือประตูทางเข้า · จำไว้ในเครื่องนี้</p>
          <Input id="station-name" name="station" defaultValue={station ?? ""} maxLength={40} list="station-suggestions" placeholder="เช่น จุดที่ 1 · โต๊ะหน้าห้อง" className="h-12 text-base" />
          <datalist id="station-suggestions"><option value="จุดที่ 1" /><option value="จุดที่ 2" /><option value="จุดที่ 3" /><option value="โต๊ะหน้าห้องประชุม" /></datalist>
          <div className="flex gap-2"><Button type="submit" size="lg" className="h-11 flex-1">บันทึก</Button><Button type="button" variant="outline" size="lg" className="h-11" popoverTarget="station-picker" popoverTargetAction="hide">ปิด</Button></div>
          <span className="text-xs text-muted-foreground">เว้นว่างแล้วบันทึก = ไม่ระบุจุด</span>
        </form>
        <Scanner key={session.id} station={station} eventId={eventId} sessionId={session.id} operatorId={user.id} sessionLabels={sessionLabels} sessionTitle={titleOf(session)} allowCamera={flags.cameraScan} />
        {corrected && <p role="status" className="rounded-lg border bg-card p-3 text-sm">{corrected === "1" ? "บันทึกการแก้ไขข้อมูลแล้ว (บันทึกใน audit log)" : corrected === "0" ? "ไม่มีข้อมูลที่เปลี่ยนแปลง" : "แก้ไขไม่ได้ กรุณาตรวจคำตอบที่บังคับกรอกและรูปแบบข้อมูล"}</p>}
        {result && <p role="status" className={cn("rounded-lg border p-3 text-sm font-semibold", result === "success" ? "border-emerald-400 bg-emerald-50 text-emerald-900" : result === "duplicate" || result === "wrong-day" ? "border-amber-400 bg-amber-50 text-amber-900" : "border-red-400 bg-red-50 text-red-900")}>{result === "success" ? "เช็คชื่อสำเร็จ" : result === "duplicate" ? "เช็คชื่อรอบนี้ไปแล้ว" : result === "wrong-day" ? "ไม่ได้ลงทะเบียนวันที่ของรอบนี้" : "เช็คชื่อไม่ได้ กรุณาตรวจข้อมูลอีกครั้ง"}</p>}
        <section aria-labelledby="search-heading" className="flex flex-col gap-3 rounded-2xl bg-card p-4">
          <h2 id="search-heading" className="font-heading text-lg font-semibold">ค้นหาผู้เข้าร่วม</h2>
          <form className="flex gap-2"><input type="hidden" name="session" value={session.id} /><div className="relative flex-1"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input name="q" defaultValue={query} aria-label="ค้นหาด้วยอีเมลหรือฟิลด์ที่อนุญาต" placeholder="ชื่อหรืออีเมล อย่างน้อย 3 ตัวอักษร" className="h-12 pl-9 text-base" /></div><Button type="submit" variant="secondary" size="lg" className="h-12">ค้นหา</Button></form>
          {query.length > 0 && query.length < 3 && <p className="text-sm text-muted-foreground">พิมพ์อย่างน้อย 3 ตัวอักษร</p>}
          {query.length >= 3 && people.length === 0 && <p className="text-sm text-muted-foreground">ไม่พบผู้ที่อนุมัติแล้วสำหรับรอบนี้</p>}
          {people.map((person) => {
            const answers = person.answers && typeof person.answers === "object" && !Array.isArray(person.answers) ? person.answers as Record<string, unknown> : {};
            return <div key={person.id} className="flex flex-col gap-2 border-t pt-3">
              <div className="flex items-center justify-between gap-2"><div className="flex min-w-0 flex-col gap-0.5">{checkinFields.length ? checkinFields.map((field, index) => <span key={field.key} className={index === 0 ? "font-semibold" : "text-xs text-muted-foreground"}>{index === 0 ? "" : `${field.label}: `}{Array.isArray(answers[field.key]) ? (answers[field.key] as string[]).join(", ") : String(answers[field.key] ?? "—")}</span>) : null}<span className="text-xs text-muted-foreground">{mask(person.email)}</span></div>{person.checkIns.length ? <span className="flex shrink-0 items-center gap-1 text-sm text-primary"><CheckIcon className="size-4" aria-hidden="true" />เช็คชื่อแล้ว</span> : <form action={checkInPersonForm.bind(null, eventId, session.id, person.id)}><Button type="submit" size="lg">เช็คชื่อ</Button></form>}</div>
              {checkinFields.length > 0 && <details className="text-sm">
                <summary className="cursor-pointer text-xs text-muted-foreground">แก้ข้อมูลที่แสดง (เช่น ชื่อสะกดผิด)</summary>
                <form action={correctCheckInAnswers.bind(null, eventId, session.id, person.id)} className="mt-2 flex flex-col gap-2 rounded-lg border p-3">
                  <input type="hidden" name="q" value={query} />
                  {checkinFields.map((field) => {
                    const current = answers[field.key];
                    const name = `answer:${field.key}`;
                    const id = `correct-${person.id}-${field.key}`;
                    return <div key={field.key} className="flex flex-col gap-1">
                      <label htmlFor={id} className="text-xs font-medium">{field.label}{field.required ? " *" : ""}</label>
                      {field.type === "select" ? <select id={id} name={name} defaultValue={typeof current === "string" ? current : ""} className="h-11 rounded-md border bg-background px-2 text-base"><option value="">—</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                        : field.type === "radio" ? <div id={id} role="radiogroup" aria-label={field.label} className="flex flex-wrap gap-3">{field.options?.map((option) => <label key={option} className="flex min-h-9 items-center gap-1 text-xs"><input type="radio" name={name} value={option} defaultChecked={current === option} />{option}</label>)}</div>
                        : field.type === "checkbox" ? <div id={id} className="flex flex-wrap gap-3">{field.options?.map((option) => <label key={option} className="flex items-center gap-1 text-xs"><input type="checkbox" name={name} value={option} defaultChecked={Array.isArray(current) && current.includes(option)} />{option}</label>)}</div>
                        : <Input id={id} name={name} type={field.type === "textarea" ? "text" : field.type} defaultValue={typeof current === "string" ? current : ""} maxLength={3000} className="h-10" />}
                    </div>;
                  })}
                  <Button type="submit" size="sm" variant="outline" className="w-fit">บันทึกการแก้ไข</Button>
                </form>
              </details>}
            </div>;
          })}
        </section>
      </div>
      <aside aria-label="ยอดและรายการเช็คชื่อ" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
        <section aria-labelledby="total-heading" className="hidden flex-col gap-3 rounded-2xl border bg-card p-5 lg:flex">
          <div className="flex items-center justify-between gap-2"><h2 id="total-heading" className="font-heading text-lg font-bold">ยอดรอบนี้</h2><span className="rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">{titleOf(session)}</span></div>
          <p className="flex items-baseline gap-2"><strong className="font-heading text-5xl text-primary">{checked}</strong><span className="text-muted-foreground">/ {expected} คนที่อนุมัติไว้{session.eventDayId ? "วันนี้" : ""}</span></p>
          <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-primary" style={{ width: `${expected ? Math.min(100, (checked / expected) * 100) : 0}%` }} /></span>
          <p className="text-xs text-muted-foreground">ยังไม่มา {Math.max(expected - checked, 0).toLocaleString("th-TH")} คน · คนเดียวเช็คได้ทุกรอบ นับแยกกัน</p>
        </section>
        <section aria-labelledby="recent-heading" className="flex flex-col rounded-2xl border bg-card p-4 lg:p-5">
          <div className="flex items-center justify-between gap-2"><h2 id="recent-heading" className="font-heading text-lg font-semibold">เช็คล่าสุด (ทุกจุด)</h2><span className="text-sm text-muted-foreground lg:hidden">รอบนี้ {checked}/{expected}</span><span className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />อัปเดตสด</span></div>
          {recent.length === 0 && <p className="mt-2 text-sm text-muted-foreground">ยังไม่มีการเช็คชื่อในรอบนี้</p>}
          {recent.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-2 border-t py-2.5 first-of-type:mt-2">
            <span className="flex min-w-0 items-center gap-2.5"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckIcon className="size-4" aria-hidden="true" /></span><span className="flex min-w-0 flex-col"><span className="truncate font-semibold">{nameOf(entry.registrant)}</span><span className="truncate text-xs text-muted-foreground"><time dateTime={entry.checkedInAt.toISOString()}>{entry.checkedInAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}</time>{detailOf(entry.registrant) ? ` · ${detailOf(entry.registrant)}` : ""}{entry.station ? ` · ${entry.station}` : ""}</span></span></span>
            <form action={undoCheckIn.bind(null, eventId, session.id, entry.registrantId)}><Button type="submit" size="sm" variant="ghost">ยกเลิก</Button></form>
          </div>)}
        </section>
      </aside>
    </main> : <main className="mx-auto w-full max-w-lg px-4 py-4"><p className="rounded-2xl bg-card p-5 text-sm text-muted-foreground">ยังไม่มีรอบเช็คชื่อ · ให้ผู้จัดเพิ่มรอบในขั้นที่ 4 ของการตั้งค่าโครงการ</p></main>}
  </>;
}
