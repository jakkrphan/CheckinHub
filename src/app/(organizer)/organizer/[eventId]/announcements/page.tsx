import type { Metadata } from "next";

import { formatDateTime } from "@/lib/format";
import { announcementHistory, announcementReach, pendingScheduleChange } from "@/server/announcements/announcements";
import { audienceLabels, DAILY_LIMIT, scheduleChangeDraft } from "@/server/announcements/audience";
import { requireEventAccess } from "@/server/authorization/event";

import { OrganizerEventHeader } from "../event-header";
import { postAnnouncement } from "./actions";
import { ComposeForm } from "./compose-form";

export const metadata: Metadata = { title: "ประกาศถึงผู้ลงทะเบียน" };

const number = (value: number) => value.toLocaleString("th-TH");

const results: Record<string, { tone: "ok" | "warn"; text: string }> = {
  invalid: { tone: "warn", text: "ส่งไม่ได้: ต้องมีหัวข้อ ข้อความ และเลือกกลุ่มผู้รับอย่างน้อย 1 กลุ่ม" },
  "no-recipients": { tone: "warn", text: "ส่งไม่ได้: กลุ่มที่เลือกไม่มีใครที่ติดต่อได้" },
  duplicate: { tone: "warn", text: "ไม่ได้ส่งซ้ำ: ประกาศเดียวกันนี้เพิ่งส่งไปเมื่อไม่ถึง 10 นาทีที่แล้ว" },
  limit: { tone: "warn", text: `ส่งไม่ได้: โครงการนี้ส่งประกาศครบ ${DAILY_LIMIT} ครั้งใน 24 ชั่วโมงแล้ว` },
  anonymized: { tone: "warn", text: "โครงการนี้ลบข้อมูลส่วนบุคคลตามระยะเก็บแล้ว ส่งประกาศไม่ได้" },
};

export default async function AnnouncementsPage({ params, searchParams }: PageProps<"/organizer/[eventId]/announcements">) {
  const { eventId } = await params;
  const query = await searchParams;
  const { event } = await requireEventAccess(eventId, "manage");
  const [{ byStatus, lineOn, emailOn }, history, scheduleChange] = await Promise.all([announcementReach(eventId), announcementHistory(eventId), pendingScheduleChange(eventId)]);
  const result = typeof query.result === "string" ? query.result : null;
  const count = (key: string) => Number(typeof query[key] === "string" ? query[key] : 0) || 0;
  const draft = scheduleChange ? scheduleChangeDraft(scheduleChange.change) : { subject: "", body: "" };

  return <>
    <OrganizerEventHeader event={event} activeTab="announcements" />
    <main className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:px-10">
      <section aria-labelledby="compose" className="flex flex-col gap-4">
        <div>
          <h2 id="compose" className="font-heading text-lg font-bold">ส่งประกาศ</h2>
          <p className="text-sm text-muted-foreground">แจ้งเรื่องที่เปลี่ยน เช่น วัน เวลา สถานที่ ถึงผู้ลงทะเบียนทุกคน แต่ละคนได้รับทางช่องทางที่เลือกไว้ตอนสมัคร (LINE หรืออีเมล)</p>
        </div>
        {result === "sent" && <p role="status" className="rounded-lg border border-primary/30 bg-accent px-4 py-3 text-sm text-accent-foreground">
          ส่งประกาศเข้าคิวแล้ว · LINE {number(count("line"))} · อีเมล {number(count("email"))}{count("unreachable") > 0 ? ` · ติดต่อไม่ได้ ${number(count("unreachable"))}` : ""} — ดูความคืบหน้าในประวัติด้านขวา</p>}
        {result && results[result] && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{results[result].text}</p>}
        {scheduleChange && <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          มีการ{scheduleChange.change === "added" ? "เพิ่ม" : "ลบ"}วันของหลักสูตรเมื่อ {formatDateTime(scheduleChange.at)}</p>}
        <div className="rounded-xl border bg-card p-5">
          <ComposeForm action={postAnnouncement.bind(null, eventId)} reach={byStatus} lineOn={lineOn} emailOn={emailOn} defaults={draft} />
        </div>
      </section>

      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h2 id="history" className="font-heading text-lg font-bold">ประวัติประกาศ</h2>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">ยังไม่เคยส่งประกาศ</p> : <ol className="flex flex-col gap-3">
          {history.map((item) => {
            const pending = item.line.pending + item.email.pending;
            return <li key={item.id} className="rounded-xl border bg-card p-4 text-sm">
              <details>
                <summary className="cursor-pointer list-none">
                  <span className="block font-semibold">{item.subject}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{formatDateTime(item.createdAt)} · {item.author?.name ?? "บัญชีที่ถูกลบ"} · ถึง {item.audience.map((status) => audienceLabels[status]).join(", ")}</span>
                </summary>
                <p className="mt-3 whitespace-pre-line border-t pt-3">{item.body}</p>
              </details>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                {([["LINE", item.line], ["อีเมล", item.email]] as const).map(([label, tally]) => <div key={label} className="rounded-md bg-muted px-2.5 py-2">
                  <dt className="font-semibold">{label}</dt>
                  <dd className="tabular-nums text-muted-foreground">ส่งแล้ว {number(tally.sent)}{tally.pending ? ` · รอส่ง ${number(tally.pending)}` : ""}{tally.failed ? ` · ไม่สำเร็จ ${number(tally.failed)}` : ""}{tally.skipped ? ` · ข้าม ${number(tally.skipped)}` : ""}</dd>
                </div>)}
              </dl>
              {(item.unreachable > 0 || pending > 0) && <p className="mt-2 text-xs text-muted-foreground">
                {pending > 0 ? "กำลังส่ง — รีเฟรชเพื่อดูความคืบหน้า" : ""}{pending > 0 && item.unreachable > 0 ? " · " : ""}{item.unreachable > 0 ? `ติดต่อไม่ได้ ${number(item.unreachable)} คน` : ""}</p>}
              {item.line.failed > 0 && <p className="mt-1 text-xs text-muted-foreground">LINE ที่ส่งไม่สำเร็จจะส่งทางอีเมลแทน (ถ้ามีอีเมล)</p>}
            </li>;
          })}
        </ol>}
      </section>
    </main>
  </>;
}
