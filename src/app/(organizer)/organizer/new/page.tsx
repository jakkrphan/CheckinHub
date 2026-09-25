import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDaysIcon, ClipboardListIcon, ImageIcon, LockKeyholeIcon, QrCodeIcon, UsersIcon } from "lucide-react";

import { createEvent } from "@/app/(organizer)/organizer/actions";
import { SeatModeFields } from "@/app/(organizer)/organizer/seat-mode-fields";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { requireActiveUser } from "@/server/authorization/session";

export const metadata: Metadata = { title: "สร้างโครงการ" };

const steps = [
  { title: "ข้อมูลโครงการ", icon: ClipboardListIcon },
  { title: "วันที่จัด & ที่นั่ง", icon: CalendarDaysIcon },
  { title: "ฟอร์มลงทะเบียน", icon: ClipboardListIcon },
  { title: "รอบเช็คชื่อ", icon: QrCodeIcon },
  { title: "ผู้ร่วมจัด & เผยแพร่", icon: UsersIcon },
];

export default async function NewEventPage({ searchParams }: PageProps<"/organizer/new">) {
  const user = await requireActiveUser();
  if (user.role === "STAFF") redirect("/check-in");
  const { error } = await searchParams;

  return (
    <form action={createEvent} encType="multipart/form-data" className="flex min-h-[calc(100svh-60px)] flex-1 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-6 border-b bg-card px-5 py-6 lg:min-h-[calc(100svh-60px)] lg:w-[300px] lg:border-b-0 lg:border-r lg:px-8 lg:py-9">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold text-muted-foreground">สร้างโครงการใหม่</p>
          <ol className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="ขั้นตอนสร้างโครงการ">
            {steps.map(({ title, icon: Icon }, index) => (
              <li key={title} aria-current={index === 0 ? "step" : undefined} className={cn("flex min-w-max items-center gap-3 rounded-lg px-3 py-3 lg:min-w-0", index === 0 ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span className="flex flex-col"><span className="text-xs">ขั้นที่ {index + 1}</span><span className="text-sm font-semibold">{title}</span></span>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-auto rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">บันทึกข้อมูลขั้นแรกเป็นฉบับร่าง แล้วตั้งค่าส่วนที่เหลือก่อนเผยแพร่</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">

        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-7 px-5 py-8 lg:px-10">
          <div role="status" className="flex items-start gap-3 rounded-lg border bg-[var(--status-warning-background)] px-4 py-3 text-sm">
            <LockKeyholeIcon className="mt-0.5 size-5 shrink-0 text-[var(--status-warning)]" aria-hidden="true" />
            <p><strong>สถานะ: ฉบับร่าง</strong> — ลิงก์ลงทะเบียนยังเปิดไม่ได้จนกว่าจะตั้งค่าครบและกดเผยแพร่</p>
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-2xl font-bold">ข้อมูลโครงการ</h2>
            <p className="text-sm text-muted-foreground">ข้อมูลนี้จะแสดงบนหน้าลงทะเบียนสาธารณะ</p>
          </div>

          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
            <FieldGroup>
              <Field><FieldLabel htmlFor="title">ชื่อโครงการ *</FieldLabel><Input id="title" name="title" maxLength={191} required placeholder="เช่น อบรมการใช้งานระบบสำหรับบุคลากรใหม่" /></Field>
              <Field><FieldLabel htmlFor="description">รายละเอียด</FieldLabel><Textarea id="description" name="description" maxLength={10000} rows={4} placeholder="อธิบายเนื้อหาและวัตถุประสงค์ของโครงการ" /></Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field><FieldLabel htmlFor="location">สถานที่</FieldLabel><Input id="location" name="location" maxLength={191} placeholder="เช่น ห้องประชุมชั้น 5" /></Field>
                <Field><FieldLabel htmlFor="deadlineDate">วันปิดรับลงทะเบียน</FieldLabel><Input id="deadlineDate" name="deadlineDate" type="date" /><p className="text-xs text-muted-foreground">ปิดรับเวลา 23:59 น. ตามเวลาไทยของวันที่เลือก</p></Field>
              </div>
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-2 text-sm font-semibold">ประเภทโครงการ *</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[["INTERNAL", "ภายใน", "บุคลากรในหน่วยงาน"], ["EXTERNAL", "ภายนอก", "บุคคลทั่วไป"], ["MIXED", "ผสม", "ทั้งภายในและภายนอก"]].map(([value, label, description]) => (
                    <label key={value} className="flex cursor-pointer flex-col gap-2 rounded-lg border bg-card p-4 has-[:checked]:border-primary has-[:checked]:bg-accent">
                      <span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="eventType" value={value} defaultChecked={value === "INTERNAL"} className="accent-primary" />{label}</span>
                      <span className="text-xs text-muted-foreground">{description}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <SeatModeFields />
            </FieldGroup>

            <div className="flex flex-col gap-4">
              <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
                <div className="flex items-center justify-between gap-3"><h3 className="font-heading text-lg font-bold">รูปปกโครงการ</h3><span className="text-xs text-muted-foreground">ไม่บังคับ</span></div>
                <label htmlFor="coverImage" className="flex aspect-video cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted text-muted-foreground"><ImageIcon className="size-8" aria-hidden="true" /><span className="text-sm">เลือกรูปปก 16:9 (JPG, PNG, WebP ไม่เกิน 3 MB)</span></label>
                <Input id="coverImage" name="coverImage" type="file" accept="image/jpeg,image/png,image/webp" />
                <p className="text-xs text-muted-foreground">local flow เก็บรูปใน private local storage และจะแสดงต่อสาธารณะเมื่อเผยแพร่โครงการ</p>
              </section>
              <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
                <h3 className="font-heading text-lg font-bold">การอนุมัติผู้ลงทะเบียน</h3>
                <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="autoApprove" className="mt-1 accent-primary" /><span className="flex flex-col gap-1"><strong>อนุมัติอัตโนมัติ</strong><span className="text-muted-foreground">หากไม่เลือก ผู้จัดจะตรวจและอนุมัติเอง</span></span></label>
                <p className="text-xs leading-relaxed text-muted-foreground">หากที่นั่งของวันที่เลือกเต็ม ใบสมัครจะเข้าคิวสำรอง การเปลี่ยนโหมดภายหลังไม่มีผลย้อนหลัง</p>
                <label className="flex flex-col gap-1 text-sm"><span>เวลาจองที่นั่งระหว่างรออนุมัติ (ชั่วโมง)</span><input name="pendingHoldHours" type="number" min={1} max={720} placeholder="ไม่หมดอายุ" className="h-9 rounded-lg border border-input bg-background px-3" /><span className="text-xs text-muted-foreground">เว้นว่างไว้หากไม่ต้องการหมดอายุ</span></label>
                <label className="flex flex-col gap-1 text-sm"><span>เมื่อมีที่นั่งว่างให้เลื่อนคิว</span><select name="waitlistPromotion" defaultValue="MANUAL" className="h-9 rounded-lg border border-input bg-background px-3"><option value="MANUAL">ให้ผู้จัดเลือกเอง</option><option value="AUTO">อัตโนมัติ ตามลำดับคิว</option></select></label>
              </section>
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error === "invalid-cover" ? "รูปปกไม่ถูกต้อง: ใช้ JPG, PNG หรือ WebP ที่มีขนาดไม่เกิน 3 MB" : "กรุณาตรวจสอบข้อมูลโครงการอีกครั้ง"}</p>}
        </main>

        <footer className="flex items-center justify-between gap-4 border-t bg-card px-5 py-4 lg:px-10">
          <Button variant="outline" asChild><Link href="/organizer">ย้อนกลับ</Link></Button>
          <div className="flex items-center gap-4"><span className="hidden text-sm text-muted-foreground sm:inline">ขั้นที่ 1 จาก 5</span><Button type="submit">บันทึกและไปตั้งค่าวันที่จัด</Button></div>
        </footer>
      </div>
    </form>
  );
}
