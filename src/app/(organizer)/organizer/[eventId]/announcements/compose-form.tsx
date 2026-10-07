"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { MailIcon, MessageCircleIcon, SendIcon, UsersIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AUDIENCE_STATUSES, audienceLabels, type AudienceStatus, BODY_MAX, type Reach, SUBJECT_MAX } from "@/server/announcements/audience";

const number = (value: number) => value.toLocaleString("th-TH");

/** The dialog's buttons: sending shows progress and locks both until the page moves on. */
function ConfirmButtons({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
    <Button type="button" variant="outline" onClick={onCancel} disabled={pending} autoFocus>ยกเลิก</Button>
    <Button type="submit" disabled={pending}><SendIcon data-icon="inline-start" aria-hidden="true" />{pending ? "กำลังส่ง…" : "ยืนยันส่งประกาศ"}</Button>
  </div>;
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
  const dialog = useRef<HTMLDialogElement>(null);
  const total = audience.reduce((sum, status) => ({
    people: sum.people + reach[status].people, line: sum.line + reach[status].line,
    email: sum.email + reach[status].email, unreachable: sum.unreachable + reach[status].unreachable,
  }), { people: 0, line: 0, email: 0, unreachable: 0 });
  const nobody = total.line + total.email === 0;
  const close = () => dialog.current?.close();
  const tiles = [
    { Icon: UsersIcon, label: "ผู้รับ", value: total.people, unit: "คน" },
    { Icon: MessageCircleIcon, label: "LINE", value: total.line, unit: "ข้อความ" },
    { Icon: MailIcon, label: "อีเมล", value: total.email, unit: "ฉบับ" },
  ];

  // Every submit (the button, or Enter in the subject) stops at the confirmation first; only its own button sends.
  return <form action={action} className="flex flex-col gap-5" onSubmit={(event) => {
    if (dialog.current?.open) return;
    event.preventDefault();
    dialog.current?.showModal();
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

    <Button type="submit" disabled={nobody || !subject.trim() || !body.trim()} className="self-start"><SendIcon data-icon="inline-start" aria-hidden="true" />ส่งประกาศ</Button>

    <dialog ref={dialog} aria-labelledby="confirmAnnouncementTitle" aria-describedby="confirmAnnouncementNote"
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      className="m-auto w-[min(30rem,calc(100%-2rem))] rounded-2xl border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50">
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h2 id="confirmAnnouncementTitle" className="font-heading text-lg font-bold">ส่งประกาศนี้?</h2>
          <p id="confirmAnnouncementNote" className="text-sm text-muted-foreground">ส่งแล้วแก้ไขหรือยกเลิกไม่ได้ ตรวจข้อความให้เรียบร้อยก่อน</p>
        </div>

        <div className="flex flex-col gap-1.5 rounded-xl border bg-background px-4 py-3">
          <p className="text-xs font-semibold text-amber-700">ประกาศจากผู้จัด</p>
          <p className="font-semibold leading-snug break-words">{subject.trim()}</p>
          <p className="line-clamp-4 whitespace-pre-line text-sm break-words text-muted-foreground">{body.trim()}</p>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center">
          {tiles.map(({ Icon, label, value, unit }) => <div key={label} className="flex flex-col items-center gap-0.5 rounded-xl bg-muted px-2 py-3">
            <dt className="flex items-center gap-1 text-xs text-muted-foreground"><Icon className="size-3.5" aria-hidden="true" />{label}</dt>
            <dd className="text-xl font-bold tabular-nums">{number(value)} <span className="text-xs font-normal text-muted-foreground">{unit}</span></dd>
          </div>)}
        </dl>
        {(total.unreachable > 0 || (!emailOn && total.email > 0)) && <ul className="flex flex-col gap-1 text-sm text-amber-800">
          {total.unreachable > 0 && <li>ติดต่อไม่ได้ {number(total.unreachable)} คน (ไม่มีอีเมลและยังไม่ได้เชื่อม LINE)</li>}
          {!emailOn && total.email > 0 && <li>ระบบอีเมลปิดอยู่ — {number(total.email)} คนที่รับทางอีเมลจะไม่ได้รับ</li>}
        </ul>}

        <ConfirmButtons onCancel={close} />
      </div>
    </dialog>
  </form>;
}
