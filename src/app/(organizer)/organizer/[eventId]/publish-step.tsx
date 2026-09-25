import Link from "next/link";
import { headers } from "next/headers";
import { CheckIcon, CircleAlertIcon, EyeOffIcon, SearchIcon, UserPlusIcon, XIcon } from "lucide-react";

import { cloneEvent } from "@/app/(organizer)/organizer/actions";
import { deleteOwnedEvent } from "@/app/(organizer)/organizer/[eventId]/delete-action";
import { addEventMember, removeEventMember } from "@/app/(organizer)/organizer/[eventId]/member-actions";
import { changeEventStatus } from "@/app/(organizer)/organizer/[eventId]/status-actions";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export type PublishCheck = { label: string; detail?: string; ready: boolean; step?: number };
type Member = { id: string; userId: string; role: "FULL" | "CHECKIN_ONLY"; user: { name: string; email: string } };

const roleDescription = { FULL: "แก้ฟอร์ม · อนุมัติ · แดชบอร์ด · export · เช็คชื่อ", CHECKIN_ONLY: "เข้าได้แค่หน้าเช็คชื่อ" } as const;
const statusChip = { DRAFT: ["ฉบับร่าง", "bg-amber-100 text-amber-900"], PUBLISHED: ["เผยแพร่แล้ว", "bg-accent text-accent-foreground"], CLOSED: ["ปิดรับแล้ว", "bg-muted text-muted-foreground"] } as const;
const initials = (name: string) => name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2) || "?";

function Avatar({ name }: { name: string }) {
  return <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">{initials(name)}</span>;
}

/** Step 5: collaborators (owner-managed) and the publish checklist, laid out as in mockup B. */
export async function PublishStep({ event, owner, members, checks, canAdminister, error, saved }: {
  event: { id: string; slug: string; status: "DRAFT" | "PUBLISHED" | "CLOSED" };
  owner: { name: string; email: string };
  members: Member[];
  checks: PublishCheck[];
  canAdminister: boolean;
  error?: string;
  saved?: string;
}) {
  const requestHeaders = await headers();
  const origin = process.env.APP_BASE_URL ?? `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`;
  const publicUrl = `${origin}/events/${event.slug}`;
  const missing = checks.filter((check) => !check.ready);
  const [statusText, statusClass] = statusChip[event.status];

  return <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
    <section aria-label="ผู้ร่วมจัด" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      {canAdminister ? <form action={addEventMember.bind(null, event.id)} className="flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="memberEmail" className="sr-only">อีเมลของผู้ใช้ในระบบ</label>
          <Input id="memberEmail" name="email" type="email" required placeholder="อีเมลของผู้ใช้ในระบบ" className="h-10 pl-9" />
        </div>
        <label htmlFor="memberRole" className="sr-only">สิทธิ์</label>
        <NativeSelect id="memberRole" name="role" defaultValue="FULL" className="h-10 w-40"><option value="FULL">เต็มสิทธิ์</option><option value="CHECKIN_ONLY">เช็คชื่ออย่างเดียว</option></NativeSelect>
        <Button type="submit" size="lg" className="h-10"><UserPlusIcon data-icon="inline-start" aria-hidden="true" />เพิ่ม</Button>
      </form> : <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">เฉพาะเจ้าของโครงการเพิ่ม/ลบผู้ร่วมจัดได้</p>}
      {(error === "invalid-member" || error === "member-not-found") && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">ไม่พบบัญชีที่ใช้งานได้จากอีเมลนี้ (หรือเป็นเจ้าของโครงการอยู่แล้ว) — ให้ผู้ดูแลระบบสร้างบัญชีก่อน</p>}
      {saved === "member" && <p role="status" className="rounded-lg border border-primary/30 bg-accent px-3 py-2 text-sm text-accent-foreground">บันทึกผู้ร่วมจัดแล้ว</p>}
      <ul className="flex flex-col divide-y border-t">
        <li className="flex items-center gap-3 py-3.5">
          <Avatar name={owner.name} />
          <span className="flex min-w-0 flex-1 flex-col"><span className="truncate font-semibold">{owner.name}</span><span className="truncate text-xs text-muted-foreground">{owner.email} · สร้างโครงการนี้</span></span>
          <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">เจ้าของ</span>
        </li>
        {members.map((member) => <li key={member.id} className="flex flex-wrap items-center gap-3 py-3.5">
          <Avatar name={member.user.name} />
          <span className="flex min-w-0 flex-1 flex-col"><span className="truncate font-semibold">{member.user.name}</span><span className="text-xs text-muted-foreground"><span className="break-all">{member.user.email}</span> · {roleDescription[member.role]}</span></span>
          {canAdminister ? <>
            <form action={addEventMember.bind(null, event.id)}>
              <input type="hidden" name="email" value={member.user.email} />
              <label htmlFor={`member-role-${member.id}`} className="sr-only">สิทธิ์ของ {member.user.name}</label>
              <AutoSubmitSelect key={member.role} id={`member-role-${member.id}`} name="role" defaultValue={member.role} className="h-10 rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="FULL">เต็มสิทธิ์</option><option value="CHECKIN_ONLY">เช็คชื่ออย่างเดียว</option></AutoSubmitSelect>
            </form>
            <form action={removeEventMember.bind(null, event.id, member.userId)}><Button type="submit" variant="outline" size="icon-lg" aria-label={`นำ ${member.user.name} ออกจากโครงการ`} className="text-destructive hover:bg-destructive/10 hover:text-destructive"><XIcon aria-hidden="true" /></Button></form>
          </> : <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">{member.role === "FULL" ? "เต็มสิทธิ์" : "เช็คชื่ออย่างเดียว"}</span>}
        </li>)}
      </ul>
      {members.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีผู้ร่วมจัด เพิ่มจากอีเมลของบัญชีที่มีอยู่ในระบบ</p>}
      <p className="flex items-start gap-2 rounded-lg bg-muted px-4 py-3 text-xs leading-relaxed text-muted-foreground"><EyeOffIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />“เช็คชื่ออย่างเดียว” จะไม่เห็นคำตอบฟอร์ม ข้อมูลส่วนตัว แดชบอร์ด หรือ export — ระบบปฏิเสธทุกหน้า นอกเหนือจากหน้าเช็คชื่อ</p>
    </section>

    <div className="flex flex-col gap-4">
      <section aria-label="เผยแพร่โครงการ" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between gap-2"><h2 className="font-heading text-lg font-bold">เผยแพร่โครงการ</h2><span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", statusClass)}>{statusText}</span></div>
        <ul className="flex flex-col gap-2.5" aria-label="รายการตรวจสอบก่อนเผยแพร่">{checks.map((check) => <li key={check.label} className="flex items-start gap-2.5">
          <span aria-hidden="true" className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", check.ready ? "bg-accent text-primary" : "bg-amber-100 text-amber-800")}>{check.ready ? <CheckIcon className="size-3.5" /> : <CircleAlertIcon className="size-3.5" />}</span>
          <span className="flex flex-col"><span className={cn("text-sm", !check.ready && "font-semibold")}>{check.label}<span className="sr-only">{check.ready ? " พร้อม" : " ยังไม่พร้อม"}</span></span>{check.detail && <span className="text-xs text-muted-foreground">{check.detail}</span>}</span>
          {!check.ready && check.step && <Link href={`/organizer/${event.id}?step=${check.step}`} className="ml-auto shrink-0 text-xs font-semibold text-primary underline-offset-4 hover:underline">ไปแก้</Link>}
        </li>)}</ul>
        <div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2.5">
          <span className="text-xs text-muted-foreground">ลิงก์ลงทะเบียน{event.status === "PUBLISHED" ? "" : " (ใช้ได้เมื่อเผยแพร่)"}</span>
          <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate font-mono text-sm">{publicUrl.replace(/^https?:\/\//, "")}</code><CopyButton value={publicUrl} /></div>
        </div>
        {error === "not-ready" && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">ยังเผยแพร่ไม่ได้ กรุณาแก้รายการที่ยังไม่พร้อมก่อน</p>}
        {saved === "status" && <p role="status" className="rounded-lg border border-primary/30 bg-accent px-3 py-2 text-sm text-accent-foreground">เปลี่ยนสถานะโครงการแล้ว</p>}
        {!canAdminister ? <p className="text-sm text-muted-foreground">เฉพาะเจ้าของโครงการกดเผยแพร่/ปิดรับได้</p>
          : event.status === "PUBLISHED" ? <div className="flex flex-col gap-2">
            <Button asChild size="lg" className="h-12"><a href={`/events/${event.slug}`} target="_blank" rel="noreferrer">เปิดหน้าลงทะเบียน</a></Button>
            <form action={changeEventStatus.bind(null, event.id, "CLOSED")}><Button type="submit" variant="outline" className="w-full">ปิดรับลงทะเบียน</Button></form>
          </div>
          : <form action={changeEventStatus.bind(null, event.id, "PUBLISHED")} className="flex flex-col gap-2">
            <Button type="submit" size="lg" className="h-12 text-base" disabled={missing.length > 0}><CheckIcon data-icon="inline-start" aria-hidden="true" />{event.status === "CLOSED" ? "เปิดรับอีกครั้ง" : "เผยแพร่ตอนนี้"}</Button>
            {missing.length > 0 && <span className="text-center text-xs text-muted-foreground">ยังขาด {missing.length} รายการ</span>}
          </form>}
        <p className="text-xs leading-relaxed text-muted-foreground">ปิดรับเองได้ทุกเมื่อ (closed) แม้ยังไม่ถึงวันปิดรับ เช่น ที่นั่งเต็มก่อนกำหนด</p>
      </section>

      <section aria-label="การจัดการอื่น" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h3 className="font-heading font-bold">การจัดการอื่น</h3>
        <div className="flex flex-wrap gap-2">
          <form action={cloneEvent.bind(null, event.id)}><Button type="submit" variant="outline" size="sm">ทำสำเนาโครงการ</Button></form>
          {event.status !== "DRAFT" && <>
            <Button asChild variant="outline" size="sm"><Link href={`/organizer/${event.id}/registrants`}>ผู้ลงทะเบียน</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href={`/organizer/${event.id}/dashboard`}>แดชบอร์ด</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href={`/check-in/${event.id}`}>เช็คชื่อหน้างาน</Link></Button>
          </>}
        </div>
        {canAdminister && <details className="rounded-lg border border-destructive/30 px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-destructive">ลบโครงการ…</summary>
          <form action={deleteOwnedEvent.bind(null, event.id)} className="mt-3 flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">ถ้ามีผู้ลงทะเบียนแล้ว ระบบจะเก็บข้อมูลเดิมไว้ตรวจสอบย้อนหลัง และปิดหน้าโครงการจากผู้ใช้งาน</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required className="size-4 accent-destructive" />ยืนยันลบโครงการนี้</label>
            <Button type="submit" variant="destructive" size="sm" className="w-fit">ลบโครงการ</Button>
          </form>
          {error === "confirm-delete" && <p role="alert" className="mt-2 text-sm text-destructive">กรุณายืนยันก่อนลบ</p>}
        </details>}
      </section>
    </div>
  </div>;
}
