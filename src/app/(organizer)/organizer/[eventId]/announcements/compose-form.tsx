"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { SendIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AUDIENCE_STATUSES, audienceLabels, type AudienceStatus, BODY_MAX, type Reach, SUBJECT_MAX } from "@/server/announcements/audience";

const number = (value: number) => value.toLocaleString("th-TH");

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={disabled || pending} className="self-start"><SendIcon data-icon="inline-start" aria-hidden="true" />{pending ? "กำลังส่ง…" : "ส่งประกาศ"}</Button>;
}

/** Compose an announcement: who gets it (by status), what it says, and how many people each channel will reach. */
export function ComposeForm({ action, reach, lineOn, emailOn, defaults }: {
  action: (formData: FormData) => Promise<void>;
  reach: Record<AudienceStatus, Reach>;
  lineOn: boolean;
  emailOn: boolean;
  defaults: { subject: string; body: string };
}) {
  const [audience, setAudience] = useState<AudienceStatus[]>(["APPROVED"]);
  const [subject, setSubject] = useState(defaults.subject);
  const [body, setBody] = useState(defaults.body);
  const total = audience.reduce((sum, status) => ({
    people: sum.people + reach[status].people, line: sum.line + reach[status].line,
    email: sum.email + reach[status].email, unreachable: sum.unreachable + reach[status].unreachable,
  }), { people: 0, line: 0, email: 0, unreachable: 0 });
  const nobody = total.line + total.email === 0;

  return <form action={action} className="flex flex-col gap-5" onSubmit={(event) => {
    if (!window.confirm(`ส่งประกาศ “${subject.trim()}” ถึงผู้ลงทะเบียน ${number(total.people)} คน?\nทาง LINE ${number(total.line)} · ทางอีเมล ${number(total.email)}\nส่งแล้วยกเลิกไม่ได้`)) event.preventDefault();
  }}>
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">ส่งถึง</legend>
      <div className="flex flex-wrap gap-2">
        {AUDIENCE_STATUSES.map((status) => <label key={status} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-checked:border-primary has-checked:bg-accent">
          <input type="checkbox" name="audience" value={status} checked={audience.includes(status)} className="size-4 accent-primary"
            onChange={(event) => setAudience(event.target.checked ? [...audience, status] : audience.filter((item) => item !== status))} />
          {audienceLabels[status]} <span className="tabular-nums text-muted-foreground">{number(reach[status].people)} คน</span>
        </label>)}
      </div>
    </fieldset>

    <div className="flex flex-col gap-1.5">
      <label htmlFor="announcementSubject" className="text-sm font-semibold">หัวข้อ</label>
      <Input id="announcementSubject" name="subject" required maxLength={SUBJECT_MAX} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="เช่น เปลี่ยนห้องอบรมวันที่ 2" />
      <p className="text-right text-xs tabular-nums text-muted-foreground">{subject.length}/{SUBJECT_MAX}</p>
    </div>
    <div className="flex flex-col gap-1.5">
      <label htmlFor="announcementBody" className="text-sm font-semibold">ข้อความ</label>
      <Textarea id="announcementBody" name="body" required maxLength={BODY_MAX} rows={7} value={body} onChange={(event) => setBody(event.target.value)}
        placeholder="รายละเอียดที่ผู้ลงทะเบียนต้องรู้ เช่น วัน เวลา สถานที่ที่เปลี่ยน" aria-describedby="announcementBodyHint" />
      <p id="announcementBodyHint" className="flex justify-between gap-3 text-xs text-muted-foreground"><span>ทุกข้อความมีปุ่มไปหน้าสถานะของแต่ละคน (QR อยู่ที่นั่น) จึงไม่ต้องใส่ลิงก์เอง</span><span className="tabular-nums">{body.length}/{BODY_MAX}</span></p>
    </div>

    <div role="status" className="flex flex-col gap-1 rounded-lg bg-muted px-4 py-3 text-sm">
      <p><strong className="tabular-nums">{number(total.people)}</strong> คน · ทาง LINE <strong className="tabular-nums">{number(total.line)}</strong> · ทางอีเมล <strong className="tabular-nums">{number(total.email)}</strong>
        {total.unreachable > 0 && <> · <span className="text-amber-800">ติดต่อไม่ได้ {number(total.unreachable)} (ไม่มีอีเมลและยังไม่ได้เชื่อม LINE)</span></>}</p>
      {total.line > 0 && <p className="text-muted-foreground">LINE นับ 1 ข้อความต่อผู้รับ 1 คน — แพ็กเกจฟรีของ OA ส่งได้ 300 ข้อความ/เดือน (รวมข้อความแจ้งผล)</p>}
      {!lineOn && <p className="text-muted-foreground">LINE ปิดอยู่ — คนที่เลือก LINE และมีอีเมลจะได้รับทางอีเมลแทน</p>}
      {!emailOn && total.email > 0 && <p className="text-amber-800">ระบบอีเมลปิดอยู่หรือยังไม่ได้ตั้งค่า — ผู้รับทางอีเมลจะไม่ได้รับประกาศนี้</p>}
    </div>

    <SubmitButton disabled={nobody || !subject.trim() || !body.trim()} />
  </form>;
}
