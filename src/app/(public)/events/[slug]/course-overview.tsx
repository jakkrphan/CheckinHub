import { CheckIcon, Rows3Icon } from "lucide-react";

import { cn } from "@/lib/utils";

type CourseDay = { id: string; date: string; label: string; schedule: string | null };

// Fixed Thai name tables: Intl output differs between Node ICU and browser ICU, which breaks hydration.
const weekdayCard = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
const monthsShort = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** Step 1 of a whole-course signup: nothing to pick, just the course seats and the days the learner commits to. */
export function CourseOverview({ days, remaining, maxSeats, waitlistEnabled }: { days: CourseDay[]; remaining: number | null; maxSeats: number | null; waitlistEnabled: boolean }) {
  const unlimited = remaining === null || maxSeats === null;
  const full = !unlimited && remaining === 0;
  const takenPercent = unlimited || maxSeats === 0 ? 0 : Math.min(100, Math.round(((maxSeats - remaining) / maxSeats) * 100));

  return <>
    <div className="flex gap-2.5 rounded-xl border border-primary/20 bg-accent p-3.5">
      <Rows3Icon className="mt-0.5 size-[18px] shrink-0 text-primary" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1"><strong className="text-sm text-accent-foreground">หลักสูตรต่อเนื่อง {days.length} วัน</strong><p className="text-[13px] leading-normal">ต้องเข้าร่วมครบทั้ง {days.length} วัน ไม่สามารถเลือกมาเฉพาะบางวันได้ — ลงทะเบียนครั้งเดียวได้ทุกวันอัตโนมัติ</p></div>
    </div>

    <div className={cn("flex items-center gap-3.5 rounded-xl border bg-card p-4", full && "border-destructive/40")}>
      <div className="flex min-w-[74px] shrink-0 flex-col items-center text-center">
        {unlimited ? <strong className="font-heading text-lg leading-tight font-bold text-accent-foreground">ไม่จำกัด</strong> : <strong className={cn("font-heading text-[30px] leading-[1.1] font-bold", full ? "text-destructive" : "text-accent-foreground")}>{remaining}</strong>}
        <span className="text-[11px] text-muted-foreground">{unlimited ? "ที่นั่ง" : `จาก ${maxSeats} ที่นั่ง`}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[13px] font-semibold">{full ? "ที่นั่งของหลักสูตรเต็มแล้ว" : unlimited ? "ที่นั่งของหลักสูตร" : "ที่นั่งคงเหลือของหลักสูตร"}</span>
        {!unlimited && <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className={cn("rounded-full", full ? "bg-destructive" : "bg-primary")} style={{ width: `${takenPercent}%` }} /></div>}
        <span className={cn("text-xs", full ? "font-semibold text-destructive" : "text-muted-foreground")}>{full ? waitlistEnabled ? "ส่งใบสมัครได้ แต่จะเข้าคิวสำรองของหลักสูตร" : "ไม่รับสมัครเพิ่ม (โครงการนี้ไม่เปิดรับรอคิว)" : unlimited ? "รับผู้เข้าร่วมได้ไม่จำกัด ลงทะเบียนครั้งเดียวครบทุกวัน" : "นับรวมทั้งหลักสูตร ไม่ได้นับแยกรายวัน"}</span>
      </div>
    </div>

    <div className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-muted-foreground">วันที่ต้องเข้าร่วม</h2>
      <ul className="flex flex-col gap-2.5">
        {days.map((day, index) => {
          const date = new Date(`${day.date}T00:00:00Z`);
          return <li key={day.id} className="flex items-center gap-4 rounded-xl border bg-card px-4 py-3.5">
            <span className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-background py-1.5"><span className="text-[11px] font-semibold">{weekdayCard[date.getUTCDay()]}</span><strong className="font-heading text-2xl leading-[1.1] font-bold">{date.getUTCDate()}</strong><span className="text-[11px]">{monthsShort[date.getUTCMonth()]}</span></span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5"><strong className="text-[15px]">วันที่ {index + 1}</strong><span className="text-[13px] text-muted-foreground">{day.schedule ?? day.label}</span></span>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-primary"><CheckIcon className="size-3.5" strokeWidth={3} aria-hidden="true" /><span className="sr-only">รวมในหลักสูตร</span></span>
          </li>;
        })}
      </ul>
    </div>
  </>;
}
