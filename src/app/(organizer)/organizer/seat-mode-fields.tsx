"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";

export function SeatModeFields({ initialMode = "per_day", maxSeats = null, attendanceThreshold = null, locked = false }: {
  initialMode?: string;
  maxSeats?: number | null;
  attendanceThreshold?: number | null;
  locked?: boolean;
}) {
  const [mode, setMode] = useState(initialMode);
  return <fieldset className="flex flex-col gap-3 rounded-xl border bg-card p-4">
    <legend className="px-1 text-sm font-semibold">รูปแบบการนับที่นั่ง</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex cursor-pointer gap-2 rounded-lg border p-3 text-sm"><input type="radio" name="seatMode" value="per_day" checked={mode === "per_day"} disabled={locked} onChange={() => setMode("per_day")} /> <span><strong>แยกรายวัน</strong><br />เลือกวันเข้าร่วมเอง ที่นั่งแยกทุกวัน</span></label>
      <label className="flex cursor-pointer gap-2 rounded-lg border p-3 text-sm"><input type="radio" name="seatMode" value="whole_course" checked={mode === "whole_course"} disabled={locked} onChange={() => setMode("whole_course")} /> <span><strong>หลักสูตรต่อเนื่อง</strong><br />สมัครครบทุกวัน ใช้ที่นั่งรวมทั้งโครงการ</span></label>
    </div>
    {locked && <input type="hidden" name="seatMode" value={mode} />}
    {mode === "whole_course" && <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">ที่นั่งทั้งหลักสูตร<Input name="maxSeats" type="number" min={1} max={1000000} defaultValue={maxSeats ?? ""} placeholder="ไม่จำกัด" /></label>
      <label className="flex flex-col gap-1 text-sm">เกณฑ์เข้าอบรมครบ (%)<Input name="attendanceThreshold" type="number" min={1} max={100} defaultValue={attendanceThreshold ?? ""} placeholder="ไม่กำหนด" /></label>
    </div>}
  </fieldset>;
}
