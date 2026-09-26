"use client";

import { useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CopyIcon, GripVerticalIcon, InfoIcon, PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";

import { addPresetSessions, copyDaySessions, moveSession, removeSession, saveSession } from "@/app/(organizer)/organizer/schedule-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export type PlannerSession = { id: string; label: string; start: string; end: string; checkIns: number; dayId: string | null };
export type PlannerDay = { id: string; number: number; title: string; shortTitle: string; seats: string | null; sessions: PlannerSession[] };

type Selection = { kind: "edit"; id: string } | { kind: "new"; scope: string };

const presetCards = [
  { key: "MORNING", label: "เช้า", time: "08:30–12:00" },
  { key: "AFTERNOON", label: "บ่าย", time: "13:00–16:30" },
  { key: "FULL_DAY", label: "เต็มวัน", time: "08:30–16:30" },
] as const;

function timeText(session: PlannerSession) {
  if (session.start || session.end) return `${session.start || "--:--"} – ${session.end || "--:--"}`;
  return session.dayId ? "ไม่ได้กำหนดเวลา" : "ทั้งวัน · ไม่ตรวจว่าลงวันไหนไว้";
}

export function SessionsPlanner({ eventId, days, everyDay, initialSession, notice }: {
  eventId: string;
  days: PlannerDay[];
  everyDay: PlannerSession[];
  initialSession?: string;
  notice?: { text: string; tone: "ok" | "error" };
}) {
  const all = [...days.flatMap((day) => day.sessions), ...everyDay];
  const [selection, setSelection] = useState<Selection>(() => {
    if (initialSession === "new") return { kind: "new", scope: days[0]?.id ?? "EVENT" };
    const target = all.find((session) => session.id === initialSession) ?? all[0];
    return target ? { kind: "edit", id: target.id } : { kind: "new", scope: days[0]?.id ?? "EVENT" };
  });
  const panel = useRef<HTMLDivElement>(null);
  const current = selection.kind === "edit" ? all.find((session) => session.id === selection.id) ?? null : null;
  const group = current ? (current.dayId ? days.find((day) => day.id === current.dayId)?.sessions ?? [] : everyDay) : [];
  const position = current ? group.findIndex((session) => session.id === current.id) : -1;
  const firstDayWithSessions = days.find((day) => day.sessions.length > 0);

  function select(next: Selection) {
    setSelection(next);
    if (!window.matchMedia("(min-width: 1280px)").matches) requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function SessionRow({ session }: { session: PlannerSession }) {
    const active = current?.id === session.id;
    return <li className={cn("flex items-center gap-3 rounded-[10px] border bg-card px-3.5 py-3", active && "border-2 border-primary px-[13px] py-[11px]")}>
      <GripVerticalIcon className="size-4 shrink-0 text-[#b9b3a6]" aria-hidden="true" />
      <button type="button" onClick={() => select({ kind: "edit", id: session.id })} aria-pressed={active} className="flex min-w-0 flex-1 flex-col text-left outline-none focus-visible:underline">
        <span className="truncate font-semibold">{session.label}</span>
        <span className="text-xs text-muted-foreground">{timeText(session)}</span>
      </button>
      {session.checkIns > 0 && <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">เช็คแล้ว {session.checkIns}</span>}
      <Button type="button" variant="outline" size="icon" onClick={() => select({ kind: "edit", id: session.id })} aria-label={`แก้รอบ ${session.label}`}><PencilIcon aria-hidden="true" /></Button>
      {session.checkIns === 0
        ? <form action={removeSession.bind(null, eventId, session.id)} onSubmit={(event) => { if (!window.confirm(`ลบรอบ “${session.label}”?`)) event.preventDefault(); }}><Button type="submit" variant="outline" size="icon" aria-label={`ลบรอบ ${session.label}`}><Trash2Icon aria-hidden="true" /></Button></form>
        : <Button type="button" variant="outline" size="icon" onClick={() => select({ kind: "edit", id: session.id })} aria-label={`ลบรอบ ${session.label} (มีประวัติเช็คชื่อ ต้องยืนยัน)`}><Trash2Icon aria-hidden="true" /></Button>}
    </li>;
  }

  const scopeDefault = current ? current.dayId ?? "EVENT" : selection.kind === "new" ? selection.scope : "EVENT";

  return <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
    <div className="flex flex-col gap-4">
      {days.length === 0 && <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">ยังไม่มีวันจัด กรุณาเพิ่มวันที่จัดในขั้นที่ 2 ก่อน</p>}
      {days.map((day) => <section key={day.id} aria-label={`รอบของวันที่ ${day.number}`} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">วันที่ {day.number}</span>
          <h3 className="font-heading text-lg font-bold">{day.title}</h3>
          {day.seats && <span className="text-xs text-muted-foreground">{day.seats}</span>}
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => select({ kind: "new", scope: day.id })}><PlusIcon data-icon="inline-start" aria-hidden="true" />เพิ่มรอบ</Button>
        </div>
        {day.sessions.length
          ? <ul className="flex flex-col gap-2.5">{day.sessions.map((session) => <SessionRow key={session.id} session={session} />)}</ul>
          : <div className="flex flex-col items-center gap-1 rounded-[10px] border border-dashed border-[#c9c3b6] px-4 py-6 text-center">
              <p className="font-semibold">ยังไม่มีรอบในวันนี้</p>
              <p className="text-xs text-muted-foreground">{everyDay.length ? "วันนี้ใช้รอบที่ใช้ได้ทุกวันได้ หรือเพิ่มรอบเฉพาะวันนี้" : "วันที่ไม่มีรอบ จะเช็คชื่อหน้างานวันนั้นไม่ได้"}</p>
            </div>}
      </section>)}
      <section aria-label="รอบที่ใช้ได้ทุกวัน" className="flex flex-col gap-3 rounded-xl border border-dashed border-[#c9c3b6] bg-card/60 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">ไม่ผูกวัน</span>
          <h3 className="font-heading text-lg font-bold">ใช้ได้ทุกวันของโครงการ</h3>
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => select({ kind: "new", scope: "EVENT" })}><PlusIcon data-icon="inline-start" aria-hidden="true" />เพิ่มรอบ</Button>
        </div>
        {everyDay.length ? <ul className="flex flex-col gap-2.5">{everyDay.map((session) => <SessionRow key={session.id} session={session} />)}</ul>
          : <p className="text-xs text-muted-foreground">เช่น “รับของที่ระลึก” เช็คได้ทุกวันและไม่ตรวจว่าผู้เข้าร่วมเลือกวันไหนไว้</p>}
      </section>
    </div>

    <div ref={panel} className="flex scroll-mt-4 flex-col gap-4">
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-5" aria-label={current ? "แก้ไขรอบ" : "เพิ่มรอบใหม่"}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-heading text-[17px] font-bold">{current ? "แก้ไขรอบ" : "เพิ่มรอบใหม่"}</h3>
          {current && <div className="flex items-center gap-1.5">
            {group.length > 1 && <>
              <form action={moveSession.bind(null, eventId, current.id, "up")}><Button type="submit" variant="outline" size="icon" disabled={position <= 0} aria-label={`เลื่อนรอบ ${current.label} ขึ้น`}><ArrowUpIcon aria-hidden="true" /></Button></form>
              <form action={moveSession.bind(null, eventId, current.id, "down")}><Button type="submit" variant="outline" size="icon" disabled={position >= group.length - 1} aria-label={`เลื่อนรอบ ${current.label} ลง`}><ArrowDownIcon aria-hidden="true" /></Button></form>
            </>}
            {current.checkIns === 0 && <form action={removeSession.bind(null, eventId, current.id)} onSubmit={(event) => { if (!window.confirm(`ลบรอบ “${current.label}”?`)) event.preventDefault(); }}>
              <Button type="submit" variant="outline" size="icon" aria-label={`ลบรอบ ${current.label}`} className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2Icon aria-hidden="true" /></Button>
            </form>}
          </div>}
        </div>
        {notice && <p role={notice.tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-sm", notice.tone === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/30 bg-accent text-accent-foreground")}>{notice.text}</p>}
        <form key={current?.id ?? `new-${scopeDefault}`} action={saveSession.bind(null, eventId, current?.id ?? null)} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="session-label">ชื่อรอบ <span className="text-destructive">*</span></FieldLabel>
            <Input id="session-label" name="label" defaultValue={current?.label ?? ""} maxLength={191} placeholder="เช่น เช้า / บ่าย / เต็มวัน" required />
            <FieldDescription>ชื่อที่เจ้าหน้าที่หน้างานเห็นตอนเลือกรอบ วันเดียวกันห้ามชื่อซ้ำ</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="session-scope">ผูกกับวันจัด</FieldLabel>
            {current && current.checkIns > 0 && <input type="hidden" name="scope" value={scopeDefault} />}
            <NativeSelect id="session-scope" name={current && current.checkIns > 0 ? undefined : "scope"} defaultValue={scopeDefault} disabled={!!current && current.checkIns > 0}>
              {days.map((day) => <option key={day.id} value={day.id}>วันที่ {day.number} · {day.shortTitle}</option>)}
              {!current && days.length > 1 && <option value="EACH_DAY">สร้างรอบนี้ให้ทุกวัน (แยกรอบรายวัน)</option>}
              <option value="EVENT">ใช้ได้ทุกวัน (ไม่ผูกวัน)</option>
            </NativeSelect>
            {current && current.checkIns > 0 && <FieldDescription>รอบที่มีการเช็คชื่อแล้วย้ายวันไม่ได้</FieldDescription>}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field><FieldLabel htmlFor="session-start">เวลาเริ่ม</FieldLabel><Input id="session-start" name="start" type="time" defaultValue={current?.start ?? ""} /></Field>
            <Field><FieldLabel htmlFor="session-end">เวลาสิ้นสุด</FieldLabel><Input id="session-end" name="end" type="time" defaultValue={current?.end ?? ""} /></Field>
          </div>
          {current && current.checkIns > 0 && <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900"><TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />รอบนี้มีการเช็คชื่อแล้ว {current.checkIns} คน — ลบรอบจะลบประวัติเช็คชื่อของรอบนี้ด้วย ระบบจะให้ยืนยันก่อน</p>}
          <div className="grid grid-cols-2 gap-3">
            <Button type="button" variant="outline" onClick={() => select({ kind: "new", scope: days[0]?.id ?? "EVENT" })}>{current ? "เพิ่มรอบใหม่แทน" : "ล้างฟอร์ม"}</Button>
            <Button type="submit"><CheckIcon data-icon="inline-start" aria-hidden="true" />{current ? "บันทึกรอบ" : "เพิ่มรอบ"}</Button>
          </div>
        </form>
        {current && current.checkIns > 0 && <form action={removeSession.bind(null, eventId, current.id)} className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" name="confirmCheckIns" required className="mt-1 size-4 accent-destructive" />ยืนยันลบรอบนี้พร้อมประวัติเช็คชื่อ {current.checkIns.toLocaleString("th-TH")} รายการ (กู้คืนไม่ได้ และบันทึกใน audit log)</label>
          <Button type="submit" variant="destructive" size="sm" className="w-fit"><Trash2Icon data-icon="inline-start" aria-hidden="true" />ลบรอบและประวัติเช็คชื่อ</Button>
        </form>}
      </section>

      {days.length > 0 && <section className="flex flex-col gap-3 rounded-xl border bg-card p-5" aria-label="เพิ่มรอบแบบเร็ว">
        <div><h3 className="font-heading text-[17px] font-bold">เพิ่มเร็ว</h3><p className="text-xs text-muted-foreground">ใส่ให้ทุกวันที่เลือกไว้พร้อมกัน (ข้ามวันที่มีรอบชื่อเดียวกันแล้ว)</p></div>
        <div className="grid grid-cols-3 gap-2">{presetCards.map((preset) => <form key={preset.key} action={addPresetSessions.bind(null, eventId, preset.key)}>
          <button type="submit" className="flex w-full flex-col items-start rounded-lg border px-3 py-2.5 text-left outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"><span className="font-semibold">{preset.label}</span><span className="text-xs text-muted-foreground">{preset.time}</span></button>
        </form>)}</div>
        {days.length > 1 && firstDayWithSessions && <form action={copyDaySessions.bind(null, eventId, firstDayWithSessions.id)}>
          <Button type="submit" variant="outline" className="w-full"><CopyIcon data-icon="inline-start" aria-hidden="true" />คัดลอกรอบของวันที่ {firstDayWithSessions.number} ไปวันอื่น</Button>
        </form>}
      </section>}

      <p className="flex items-start gap-2 rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed text-muted-foreground"><InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />คนเดียวเช็คได้ทุกรอบ นับแยกกัน · กันสแกนซ้ำเฉพาะภายในรอบเดียวกัน · รอบที่ผูกวัน หน้างานจะตรวจก่อนว่าคนนั้นเลือกวันนั้นไว้จริง</p>
    </div>
  </div>;
}
