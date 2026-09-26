"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon, EllipsisIcon, LoaderCircleIcon, MinusIcon, PlusIcon, UsersIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ServerAction = (formData: FormData) => Promise<void>;

export type PlannerDay = {
  id: string;
  date: string; // YYYY-MM-DD
  number: number;
  maxSeats: number | null;
  approved: number;
  occupied: number;
  registrants: number;
  isClosed: boolean;
  removable: boolean;
  update: ServerAction;
  remove: ServerAction;
};

const weekdays = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
// Fixed Thai names instead of Intl: Node and browsers ship different ICU data, which breaks hydration.
const weekdayShort = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const weekdayLong = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const monthsShort = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const monthsLong = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const asDate = (key: string) => new Date(`${key}T00:00:00Z`);
const monthTitle = { format: (date: Date) => `${monthsLong[date.getUTCMonth()]} ${date.getUTCFullYear() + 543}` };
const dayLong = { format: (date: Date) => `วัน${weekdayLong[date.getUTCDay()]}ที่ ${date.getUTCDate()} ${monthsLong[date.getUTCMonth()]} ${date.getUTCFullYear() + 543}` };
const dayShort = { format: (date: Date) => `${weekdayShort[date.getUTCDay()]} ${date.getUTCDate()} ${monthsShort[date.getUTCMonth()]}` };
const toKey = (year: number, month: number, day: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const formData = (entries: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) for (const item of [value].flat()) data.append(name, item);
  return data;
};

/** Step 2 (mockup B): click calendar days to add/remove them; per-day seats use a stepper that saves on its own. */
export type CourseSeats = { maxSeats: number | null; taken: number; waitlisted: number; update: ServerAction };

export function DaysPlanner({ days, today, seatMode, addDays, course }: {
  days: PlannerDay[];
  today: string;
  seatMode: "per_day" | "whole_course";
  addDays: ServerAction;
  /** Whole-course events only: the single course-wide seat limit and who holds it. */
  course: CourseSeats | null;
}) {
  const [month, setMonth] = useState(() => {
    const anchor = days.find((day) => day.date >= today)?.date ?? today;
    const [year, number] = anchor.split("-").map(Number);
    return { year, number: number - 1 };
  });
  const perDay = seatMode === "per_day";
  // New days start with the most recent day's seat limit, so organizers rarely need to touch the stepper.
  const defaultSeats = days.at(-1)?.maxSeats?.toString() ?? "";
  const totalSeats = days.reduce((sum, day) => sum + (day.maxSeats ?? 0), 0);
  const hasUnlimited = days.some((day) => day.maxSeats === null);

  function changeMonth(offset: number) {
    const date = new Date(Date.UTC(month.year, month.number + offset, 1));
    setMonth({ year: date.getUTCFullYear(), number: date.getUTCMonth() });
  }

  return <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
    <section aria-label="ปฏิทินเลือกวันที่จัด" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" size="icon-lg" onClick={() => changeMonth(-1)} aria-label="เดือนก่อน"><ChevronLeftIcon aria-hidden="true" /></Button>
        <h3 className="font-heading text-lg font-bold" aria-live="polite">{monthTitle.format(new Date(Date.UTC(month.year, month.number, 1)))}</h3>
        <Button type="button" variant="outline" size="icon-lg" onClick={() => changeMonth(1)} aria-label="เดือนถัดไป"><ChevronRightIcon aria-hidden="true" /></Button>
      </div>
      {/* Each free date is a submit button of this form, so adding days also works before hydration. */}
      <form action={addDays}>
        <input type="hidden" name="maxSeats" value={perDay ? defaultSeats : ""} />
        <CalendarGrid year={month.year} month={month.number} days={days} today={today} perDay={perDay} />
      </form>
      <p className="text-xs leading-relaxed text-muted-foreground">คลิกวันว่างเพื่อเพิ่ม · คลิกวันที่เลือกแล้วเพื่อเอาออก (เฉพาะวันที่ยังไม่มีผู้สมัครและรอบเช็คชื่อ){perDay && defaultSeats ? ` · วันใหม่ได้ ${Number(defaultSeats).toLocaleString("th-TH")} ที่นั่งเริ่มต้น` : ""}</p>
    </section>

    <div className="flex min-w-0 flex-col gap-4">
    {!perDay && course && <CourseSeatsCard course={course} />}
    <section aria-labelledby="picked-days" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
        <h3 id="picked-days" className="font-heading text-lg font-bold">{perDay ? `เลือกแล้ว ${days.length} วัน` : `วันของหลักสูตร · ${days.length} วัน`}</h3>
        <span className="text-sm text-muted-foreground">{perDay ? `ที่นั่งรวม ${totalSeats.toLocaleString("th-TH")}${hasUnlimited ? " + ไม่จำกัด" : ""}` : "ทุกคนเข้าร่วมครบทุกวัน"}</span>
      </div>
      {days.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted-foreground">ยังไม่มีวันจัด · คลิกวันในปฏิทินเพื่อเพิ่ม</p>
        // Rows follow this card's width (container queries): beside the calendar on xl it is narrower than on a tablet.
        : <ul className="@container divide-y">{days.map((day) => <DayRow key={`${day.id}-${day.maxSeats}-${day.isClosed}-${day.date}`} day={day} perDay={perDay} lastDay={days.length === 1} />)}</ul>}
      <p className="border-t bg-muted/50 px-5 py-3 text-xs leading-relaxed text-muted-foreground">{perDay ? "ขั้นที่ 4 (รอบเช็คชื่อ) จะผูกรอบกับวันเหล่านี้ได้ เช่น “วันที่ 1 · เช้า”" : "ช่องกรอกที่นั่งรายวันถูกซ่อนในโหมดนี้ เพื่อไม่ให้เข้าใจผิดว่ารับกี่คนต่อวัน · เพิ่มวันหลังเผยแพร่ ระบบจะผูกวันใหม่ให้ผู้ลงทะเบียนทุกคนอัตโนมัติ แล้วเตือนให้ส่งประกาศแจ้ง"}</p>
    </section>
    </div>
  </div>;
}

function CalendarGrid({ year, month, days, today, perDay }: { year: number; month: number; days: PlannerDay[]; today: string; perDay: boolean }) {
  const { pending, data } = useFormStatus();
  const [removing, setRemoving] = useState<string | null>(null);
  const byDate = new Map(days.map((day) => [day.date, day]));
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // `removing` may be stale after a submit finishes, but it is only read while a submit is pending.
  const busyDate = pending ? data?.get("dates") ?? removing : null;

  function reveal(date: string) {
    const row = document.getElementById(`day-${date}`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.focus({ preventScroll: true });
  }

  return <div className="grid grid-cols-7 gap-1.5">
    {weekdays.map((name) => <span key={name} className="pb-1 text-center text-xs font-semibold text-muted-foreground">{name}</span>)}
    {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
    {Array.from({ length: daysInMonth }, (_, index) => {
      const date = toKey(year, month, index + 1);
      const day = byDate.get(date);
      const past = date < today;
      const busy = busyDate === date;
      const removable = !!day && perDay && day.removable;
      return <button key={date} type={day && !removable ? "button" : "submit"} name={day ? undefined : "dates"} value={day ? undefined : date}
        formAction={removable ? day.remove : undefined} onClick={day && !removable ? () => reveal(date) : removable ? () => setRemoving(date) : undefined}
        disabled={(past && !day) || pending} aria-pressed={!!day}
        aria-label={`${dayLong.format(asDate(date))}${day ? ` · วันที่ ${day.number} ของโครงการ${removable ? " · คลิกเพื่อเอาออก" : ""}` : " · คลิกเพื่อเพิ่ม"}`}
        className={cn("flex h-12 flex-col items-center justify-center rounded-lg font-heading text-base transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed",
          day ? "bg-primary font-bold text-primary-foreground hover:bg-primary/90" : "font-medium hover:bg-muted",
          past && !day && "text-muted-foreground/40 hover:bg-transparent", busy && "opacity-60")}>
        {busy ? <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> : index + 1}
        {day && !busy && <span className="font-sans text-[10px] font-semibold leading-none">วันที่ {day.number}</span>}
      </button>;
    })}
  </div>;
}

function DayRow({ day, perDay, lastDay }: { day: PlannerDay; perDay: boolean; lastDay: boolean }) {
  const [seats, setSeats] = useState(day.maxSeats?.toString() ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useRef<number | undefined>(undefined);
  const minimum = Math.max(1, day.occupied);
  const value = seats === "" ? null : Number(seats);
  const invalid = value !== null && (!Number.isInteger(value) || value < minimum);
  const full = day.maxSeats !== null && day.approved >= day.maxSeats;
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function save(next: string, delay = 700) {
    window.clearTimeout(timer.current);
    const number = next === "" ? null : Number(next);
    if (number !== null && (!Number.isInteger(number) || number < minimum)) return;
    if (number === day.maxSeats) return;
    timer.current = window.setTimeout(() => startTransition(() => day.update(formData({ date: day.date, maxSeats: next, ...(day.isClosed ? { isClosed: "on" } : {}) }))), delay);
  }
  function step(offset: number) {
    const next = value === null ? (offset > 0 ? String(Math.max(minimum, 10)) : "") : String(Math.max(minimum, value + offset));
    setSeats(next);
    save(next);
  }

  return <li id={`day-${day.date}`} tabIndex={-1} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center @max-sm:grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 px-4 py-4 @lg:gap-x-4 @lg:px-5 outline-none focus:bg-accent/40 @lg:grid-cols-[110px_minmax(0,1fr)_auto_auto]">
    <div className="flex flex-col">
      <span className="whitespace-nowrap text-xs text-muted-foreground">วันที่ {day.number}</span>
      <span className="whitespace-nowrap font-heading font-bold">{dayShort.format(asDate(day.date))}</span>
      {day.isClosed && <span className="mt-1 w-fit rounded bg-destructive/10 px-1.5 text-[11px] font-semibold text-destructive">ปิดรับวันนี้</span>}
    </div>
    <div className="order-last col-span-3 flex flex-col gap-1.5 @max-sm:col-span-2 @lg:order-none @lg:col-span-1">
      {perDay ? <>
        <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", full ? "bg-destructive" : "bg-primary")} style={{ width: day.maxSeats ? `${Math.min(100, (day.approved / day.maxSeats) * 100)}%` : day.approved ? "100%" : "0%", opacity: day.maxSeats ? 1 : 0.25 }} /></span>
        <span className={cn("text-xs", full ? "font-semibold text-destructive" : "text-muted-foreground")}>{full ? "เต็มแล้ว " : "อนุมัติ "}{day.approved.toLocaleString("th-TH")} / {day.maxSeats?.toLocaleString("th-TH") ?? "ไม่จำกัด"} ที่{day.registrants > day.approved ? ` · สมัครทั้งหมด ${day.registrants.toLocaleString("th-TH")}` : ""}</span>
      </> : <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><UsersIcon className="size-4" aria-hidden="true" />ผู้เข้าอบรมทั้ง {day.registrants.toLocaleString("th-TH")} คน</span>}
    </div>
    {perDay ? <div className="flex flex-col items-end gap-1 @max-sm:col-span-2 @max-sm:row-start-2 @max-sm:items-start">
      <div className={cn("flex h-10 items-center rounded-lg border bg-background", invalid && "border-destructive")}>
        <button type="button" onClick={() => step(-1)} disabled={value === null || value <= minimum} aria-label={`ลดที่นั่งวันที่ ${day.number}`} className="flex size-10 items-center justify-center rounded-l-lg hover:bg-muted disabled:opacity-40"><MinusIcon className="size-4" aria-hidden="true" /></button>
        <label htmlFor={`seats-${day.id}`} className="sr-only">ที่นั่งวันที่ {day.number} (เว้นว่าง = ไม่จำกัด)</label>
        <input id={`seats-${day.id}`} inputMode="numeric" value={seats} placeholder="ไม่จำกัด" aria-invalid={invalid || undefined}
          onChange={(event) => { const next = event.target.value.replace(/[^0-9]/g, ""); setSeats(next); save(next, 1200); }}
          onBlur={() => save(seats, 0)} className="h-full w-16 border-x @lg:w-20 bg-transparent text-center font-semibold outline-none placeholder:text-sm placeholder:font-normal placeholder:text-muted-foreground focus-visible:bg-accent/50" />
        <button type="button" onClick={() => step(1)} aria-label={`เพิ่มที่นั่งวันที่ ${day.number}`} className="flex size-10 items-center justify-center rounded-r-lg hover:bg-muted"><PlusIcon className="size-4" aria-hidden="true" /></button>
      </div>
      <span className="min-h-4 text-[11px] text-muted-foreground" aria-live="polite">{pending ? "กำลังบันทึก…" : invalid ? <span className="text-destructive">ต่ำสุด {minimum.toLocaleString("th-TH")} (มีคนจองแล้ว)</span> : ""}</span>
    </div> : <span />}
    <DayMenu day={day} perDay={perDay} lastDay={lastDay} />
  </li>;
}

function DayMenu({ day, perDay, lastDay }: { day: PlannerDay; perDay: boolean; lastDay: boolean }) {
  const id = `day-menu-${day.id}`;
  const canRemove = perDay ? day.removable : !lastDay;
  return <div className="flex items-center gap-1 @max-sm:col-start-2 @max-sm:row-start-1">
    <Button type="button" variant="ghost" size="icon-lg" popoverTarget={id} aria-label={`ตัวเลือกวันที่ ${day.number}`}><EllipsisIcon aria-hidden="true" /></Button>
    <div id={id} popover="auto" className="m-auto w-[min(92vw,340px)] rounded-xl border bg-card p-5 shadow-xl backdrop:bg-black/20">
      <h4 className="mb-3 font-heading font-bold">วันที่ {day.number} · {dayShort.format(asDate(day.date))}</h4>
      <form action={day.update} className="flex flex-col gap-3">
        <input type="hidden" name="maxSeats" value={day.maxSeats?.toString() ?? ""} />
        <label className="flex flex-col gap-1.5 text-sm font-medium">ย้ายไปวันที่
          <input type="date" name="date" defaultValue={day.date} required disabled={day.registrants > 0} className="h-10 rounded-lg border bg-background px-3 disabled:opacity-60" />
          {day.registrants > 0 && <span className="text-xs font-normal text-muted-foreground">มีผู้สมัครแล้ว ย้ายวันไม่ได้</span>}
        </label>
        {day.registrants > 0 && <input type="hidden" name="date" value={day.date} />}
        {perDay && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isClosed" defaultChecked={day.isClosed} className="size-4 accent-primary" />ปิดรับสมัครวันนี้</label>}
        <Button type="submit" size="sm">บันทึก</Button>
      </form>
      {!perDay && canRemove && <form action={day.remove} className="mt-3 flex flex-col gap-2 border-t pt-3">
        <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" name="confirm" required className="mt-0.5 size-4 accent-destructive" />ยืนยันลบวันนี้ออกจากผู้สมัครทุกคนและลบรอบเช็คชื่อของวันนี้ · ควรแจ้งผู้เข้าอบรมหลังบันทึก</label>
        <Button type="submit" variant="destructive" size="sm">ลบวันนี้</Button>
      </form>}
    </div>
    {perDay && <form action={day.remove}>
      <Button type="submit" variant="ghost" size="icon-lg" disabled={!canRemove} aria-label={`ลบวันที่ ${day.number} ออกจากโครงการ`} title={canRemove ? undefined : "มีผู้สมัครหรือรอบเช็คชื่อแล้ว เอาออกไม่ได้"} className="text-muted-foreground hover:text-destructive"><XIcon aria-hidden="true" /></Button>
    </form>}
  </div>;
}

/** Whole-course seat limit (mockup B v3): one number for the course, saved with a stepper like the per-day seats. */
function CourseSeatsCard({ course }: { course: CourseSeats }) {
  const [seats, setSeats] = useState(course.maxSeats?.toString() ?? "");
  const [pending, startTransition] = useTransition();
  const minimum = Math.max(1, course.taken);
  const value = seats === "" ? null : Number(seats);
  const invalid = value !== null && (!Number.isInteger(value) || value < minimum);
  const remaining = course.maxSeats === null ? null : Math.max(course.maxSeats - course.taken, 0);
  const changed = (value ?? null) !== course.maxSeats;
  function step(offset: number) {
    setSeats(value === null ? (offset > 0 ? String(Math.max(minimum, 20)) : "") : String(Math.max(minimum, value + offset)));
  }

  return <section aria-labelledby="course-seats" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
    <div className="flex flex-col gap-0.5">
      <h3 id="course-seats" className="font-heading text-lg font-bold">ที่นั่งของทั้งหลักสูตร</h3>
      <p className="text-sm text-muted-foreground">รับได้กี่คนตลอดหลักสูตร ไม่ใช่กี่คนต่อวัน</p>
    </div>
    <form action={(formData) => startTransition(() => course.update(formData))} className="flex flex-col gap-2">
      <label htmlFor="course-max-seats" className="text-sm font-semibold">จำนวนที่นั่งทั้งหลักสูตร</label>
      <div className="flex flex-wrap items-center gap-2">
        <div className={cn("flex h-12 items-center rounded-lg border bg-background", invalid && "border-destructive")}>
          <button type="button" onClick={() => step(-1)} disabled={value === null || value <= minimum} aria-label="ลดที่นั่ง" className="flex size-12 items-center justify-center rounded-l-lg hover:bg-muted disabled:opacity-40"><MinusIcon className="size-4" aria-hidden="true" /></button>
          <input id="course-max-seats" name="maxSeats" inputMode="numeric" value={seats} placeholder="ไม่จำกัด" aria-invalid={invalid || undefined} onChange={(event) => setSeats(event.target.value.replace(/[^0-9]/g, ""))} className="h-full w-24 border-x bg-transparent text-center font-heading text-xl font-bold outline-none placeholder:text-sm placeholder:font-normal placeholder:text-muted-foreground" />
          <button type="button" onClick={() => step(1)} aria-label="เพิ่มที่นั่ง" className="flex size-12 items-center justify-center rounded-r-lg hover:bg-muted"><PlusIcon className="size-4" aria-hidden="true" /></button>
        </div>
        <Button type="submit" disabled={!changed || invalid || pending} className="h-12">{pending ? "กำลังบันทึก…" : "บันทึกที่นั่ง"}</Button>
      </div>
      <span className={cn("text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>{invalid ? `ต่ำสุด ${minimum.toLocaleString("th-TH")} (มีคนจองแล้ว)` : "เว้นว่าง = ไม่จำกัด"}</span>
    </form>
    <div className="flex items-center gap-4 rounded-lg bg-accent px-4 py-3 text-accent-foreground">
      <strong className="font-heading text-3xl">{remaining === null ? "∞" : remaining.toLocaleString("th-TH")}</strong>
      <span className="flex flex-col text-sm"><span className="font-semibold">ที่นั่งคงเหลือของหลักสูตร</span><span className="text-xs opacity-80">รับแล้ว {course.taken.toLocaleString("th-TH")} คน (รออนุมัติ + อนุมัติแล้ว){course.waitlisted ? ` · คิวรอ ${course.waitlisted.toLocaleString("th-TH")} คน` : ""}</span></span>
    </div>
  </section>;
}
