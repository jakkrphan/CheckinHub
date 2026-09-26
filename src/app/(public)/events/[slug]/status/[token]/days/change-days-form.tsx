"use client";

import { useState } from "react";
import { LockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DayChoice = {
  id: string;
  number: number;
  label: string;
  selected: boolean;
  statusLabel: string | null;
  remaining: number | null;
  /** Why this day cannot be toggled (checked in, closed, rejected, past), if so. */
  locked: string | null;
};

export function ChangeDaysForm({ action, days, autoApprove }: { action: (formData: FormData) => Promise<void>; days: DayChoice[]; autoApprove: boolean }) {
  const [picked, setPicked] = useState(() => new Set(days.filter((day) => day.selected).map((day) => day.id)));
  const added = days.filter((day) => !day.selected && picked.has(day.id));
  const removed = days.filter((day) => day.selected && !picked.has(day.id));
  const toggle = (id: string, on: boolean) => setPicked((current) => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });

  return <form action={action} className="flex flex-col gap-4">
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold">เลือกวันที่จะเข้าร่วม</legend>
      {days.map((day) => {
        const on = picked.has(day.id);
        return <label key={day.id} className={cn("flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 py-3", day.locked ? "cursor-not-allowed opacity-80" : "cursor-pointer has-checked:border-2 has-checked:border-primary has-checked:bg-accent")}>
          <input type="checkbox" name={day.locked ? undefined : "dayId"} value={day.id} checked={on} disabled={!!day.locked} onChange={(event) => toggle(day.id, event.target.checked)} className="size-5 shrink-0 accent-primary" />
          {day.locked && on && <input type="hidden" name="dayId" value={day.id} />}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">วันที่ {day.number} · {day.label}</span>
            <span className="text-xs text-muted-foreground">{day.locked ? <span className="inline-flex items-center gap-1"><LockIcon className="size-3" aria-hidden="true" />{day.locked}</span>
              : day.selected ? day.statusLabel : day.remaining === null ? "ที่นั่งไม่จำกัด" : day.remaining === 0 ? "เต็มแล้ว · จะเข้าคิวสำรอง" : `เหลือ ${day.remaining.toLocaleString("th-TH")} ที่นั่ง`}</span>
          </span>
          {day.selected && day.statusLabel && <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">{day.statusLabel}</span>}
        </label>;
      })}
    </fieldset>

    <div aria-live="polite" className="flex flex-col gap-1 rounded-xl bg-muted px-4 py-3 text-sm">
      {!added.length && !removed.length ? <span className="text-muted-foreground">ยังไม่มีการเปลี่ยนแปลง</span> : <>
        {added.length > 0 && <span><strong>เพิ่ม</strong> {added.map((day) => `วันที่ ${day.number}`).join(", ")} — {autoApprove ? "ได้ที่นั่งทันทีถ้ายังว่าง" : "รอผู้จัดอนุมัติ"} · ถ้าเต็มจะเข้าคิวสำรอง</span>}
        {removed.length > 0 && <span><strong>ยกเลิก</strong> {removed.map((day) => `วันที่ ${day.number}`).join(", ")} — ที่นั่งจะคืนให้คนในคิว</span>}
      </>}
      {picked.size === 0 && <span role="alert" className="text-destructive">ต้องเหลืออย่างน้อย 1 วัน · ถ้าไม่มาทุกวันให้ใช้ “ยกเลิกการเข้าร่วม” ที่หน้าสถานะ</span>}
    </div>

    <Button type="submit" size="lg" className="h-12" disabled={picked.size === 0 || (!added.length && !removed.length)}>บันทึกการเปลี่ยนวัน</Button>
  </form>;
}
