"use client";

import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const weekdays = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const monthFormatter = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

type EventDayCalendarProps = {
  action: (formData: FormData) => Promise<void>;
  selectedDays: string[];
  today: string;
  seatMode?: string;
};

function toDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function EventDayCalendar({ action, selectedDays, today, seatMode = "per_day" }: EventDayCalendarProps) {
  const [month, setMonth] = useState(() => {
    const [year, monthNumber] = today.split("-").map(Number);
    return { year, number: monthNumber - 1 };
  });
  const [pendingDates, setPendingDates] = useState<string[]>([]);
  const existingDays = new Map(selectedDays.map((date, index) => [date, index + 1]));
  const firstWeekday = new Date(Date.UTC(month.year, month.number, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(month.year, month.number + 1, 0)).getUTCDate();
  const monthTitle = monthFormatter.format(new Date(Date.UTC(month.year, month.number, 1)));

  function changeMonth(offset: number) {
    const date = new Date(Date.UTC(month.year, month.number + offset, 1));
    setMonth({ year: date.getUTCFullYear(), number: date.getUTCMonth() });
  }

  function toggleDate(date: string) {
    setPendingDates((current) => current.includes(date)
      ? current.filter((item) => item !== date)
      : [...current, date].sort());
  }

  return (
    <section className="flex h-fit flex-col gap-5 rounded-xl border bg-card p-5" aria-label="ปฏิทินเลือกวันที่จัด">
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" size="icon" onClick={() => changeMonth(-1)} aria-label="เดือนก่อน"><ChevronLeftIcon aria-hidden="true" /></Button>
        <h3 className="font-heading text-lg font-bold">{monthTitle}</h3>
        <Button type="button" variant="outline" size="icon" onClick={() => changeMonth(1)} aria-label="เดือนถัดไป"><ChevronRightIcon aria-hidden="true" /></Button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weekdays.map((day) => <span key={day} className="pb-2 text-center text-xs font-semibold text-muted-foreground">{day}</span>)}
        {Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const date = toDateKey(month.year, month.number, index + 1);
          const order = existingDays.get(date);
          const isPast = date < today;
          return order ? (
            <a key={date} href={`#day-${date}`} aria-label={`${date} วันที่จัดลำดับที่ ${order} ไปยังรายการวัน`} className="flex h-12 flex-col items-center justify-center rounded-lg bg-primary font-heading text-sm font-bold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {index + 1}<span className="font-sans text-[10px] font-medium">วันที่ {order}</span>
            </a>
          ) : (
            <button key={date} type="button" disabled={isPast} aria-pressed={pendingDates.includes(date)} aria-label={`เลือกวันที่ ${dayFormatter.format(new Date(`${date}T00:00:00Z`))}`} onClick={() => toggleDate(date)} className={cn("h-12 rounded-lg font-heading text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", pendingDates.includes(date) ? "border-2 border-primary bg-accent text-accent-foreground" : "hover:bg-muted", isPast && "cursor-not-allowed text-muted-foreground/50 hover:bg-transparent")}>{index + 1}</button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className="size-3 rounded-sm bg-primary" aria-hidden="true" />วันที่เพิ่มแล้ว · คลิกเพื่อไปแก้ไข</span><span className="flex items-center gap-2"><span className="size-3 rounded-sm border-2 border-primary bg-accent" aria-hidden="true" />เลือกใหม่ · คลิกซ้ำเพื่อเอาออก</span></div>
      <form action={action} className="flex flex-col gap-4 border-t pt-5">
        {pendingDates.map((date) => <input key={date} type="hidden" name="dates" value={date} />)}
        <p className="text-sm font-medium" aria-live="polite">{pendingDates.length ? `เลือกใหม่ ${pendingDates.length} วัน: ${pendingDates.map((date) => dayFormatter.format(new Date(`${date}T00:00:00Z`))).join(", ")}` : "เลือกวันที่ใหม่จากปฏิทิน (เลือกข้ามเดือนได้)"}</p>
        {seatMode === "per_day" && <FieldGroup>
          <Field><FieldLabel htmlFor="new-day-seats">จำนวนที่นั่งเริ่มต้นต่อวัน</FieldLabel><Input id="new-day-seats" name="maxSeats" type="number" min={1} max={1000000} placeholder="ไม่จำกัด" /><span className="text-xs text-muted-foreground">เว้นว่างไว้หากไม่จำกัดจำนวนที่นั่ง</span></Field>
        </FieldGroup>}
        <Button type="submit" disabled={pendingDates.length === 0 || pendingDates.length > 60}>เพิ่มวันจัด {pendingDates.length || ""} วัน</Button>
        {pendingDates.length > 60 && <p role="alert" className="text-sm text-destructive">เพิ่มได้สูงสุดครั้งละ 60 วัน</p>}
      </form>
    </section>
  );
}
