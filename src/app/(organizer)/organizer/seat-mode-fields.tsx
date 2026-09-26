"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const modes = [
  ["per_day", "แยกรายวัน", "ผู้สมัครเลือกวันเอง · ที่นั่งแยกแต่ละวัน"],
  ["whole_course", "หลักสูตรต่อเนื่อง", "สมัครครั้งเดียวครบทุกวัน · ที่นั่งรวมทั้งหลักสูตร"],
] as const;

export function SeatModeFields({ initialMode = "per_day", maxSeats = null, attendanceThreshold = null, locked = false }: {
  initialMode?: string;
  maxSeats?: number | null;
  attendanceThreshold?: number | null;
  locked?: boolean;
}) {
  const [mode, setMode] = useState(initialMode);
  return <fieldset className="flex flex-col gap-3">
    <legend className="mb-2 text-sm font-semibold">รูปแบบการนับที่นั่ง *</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      {modes.map(([value, label, description]) => <label key={value} className={cn("flex flex-col gap-1.5 rounded-lg border bg-card p-4 has-checked:border-2 has-checked:border-primary has-checked:bg-accent", locked ? "cursor-not-allowed opacity-70" : "cursor-pointer")}>
        <span className="flex items-center gap-2.5 font-semibold"><input type="radio" name="seatMode" value={value} checked={mode === value} disabled={locked} onChange={() => setMode(value)} className="size-4 accent-primary" />{label}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
      </label>)}
    </div>
    {locked && <><input type="hidden" name="seatMode" value={mode} /><p className="text-xs text-muted-foreground">เปลี่ยนรูปแบบที่นั่งได้เฉพาะโครงการฉบับร่างที่ยังไม่มีผู้ลงทะเบียน</p></>}
    {mode === "whole_course" && <div className="grid gap-3 rounded-lg bg-muted/60 p-4 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-sm font-medium">ที่นั่งทั้งหลักสูตร<Input name="maxSeats" type="number" min={1} max={1000000} defaultValue={maxSeats ?? ""} placeholder="ไม่จำกัด" className="h-10 bg-card" /></label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">เกณฑ์เข้าอบรมครบ (%)<Input name="attendanceThreshold" type="number" min={1} max={100} defaultValue={attendanceThreshold ?? ""} placeholder="ไม่กำหนด" className="h-10 bg-card" /></label>
    </div>}
  </fieldset>;
}
