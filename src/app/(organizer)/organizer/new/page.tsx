import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeftIcon, LockKeyholeIcon } from "lucide-react";

import { createEvent } from "@/app/(organizer)/organizer/actions";
import { EventInfoFields } from "@/app/(organizer)/organizer/event-info-fields";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireActiveUser } from "@/server/authorization/session";

export const metadata: Metadata = { title: "สร้างโครงการ" };

const steps = ["ข้อมูลโครงการ", "วันที่จัด & ที่นั่ง", "ฟอร์มลงทะเบียน", "รอบเช็คชื่อ", "ผู้ร่วมจัด & เผยแพร่"];

export default async function NewEventPage({ searchParams }: PageProps<"/organizer/new">) {
  const user = await requireActiveUser();
  if (user.role === "STAFF") redirect("/check-in");
  const { error } = await searchParams;

  return (
    <form action={createEvent} encType="multipart/form-data" className="flex min-h-[calc(100svh-60px)] flex-1 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-6 border-b bg-card px-5 py-6 lg:min-h-[calc(100svh-60px)] lg:w-[300px] lg:gap-6 lg:border-b-0 lg:border-r lg:px-8 lg:py-9">
        <div className="flex flex-col gap-1">
          <Link href="/organizer" className="-my-2.5 flex w-fit items-center gap-1 py-2.5 text-sm text-muted-foreground hover:text-foreground"><ChevronLeftIcon className="size-4" aria-hidden="true" />โครงการของฉัน</Link>
          <h2 className="font-heading text-xl font-bold">สร้างโครงการ</h2>
        </div>
        <ol className="grid grid-cols-5 gap-1 lg:flex lg:flex-col lg:gap-0" aria-label="ขั้นตอนสร้างโครงการ">
          {steps.map((title, index) => (
            <li key={title} aria-current={index === 0 ? "step" : undefined} className="relative flex min-w-0 flex-col items-center gap-2 px-1 py-2 text-center lg:min-h-[68px] lg:flex-row lg:gap-3 lg:px-2 lg:text-left">
              <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-card text-sm font-semibold", index === 0 ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground")}>{index + 1}</span>
              <span className="flex min-w-0 flex-col lg:gap-0.5"><span className="hidden text-xs text-muted-foreground lg:block">ขั้นที่ {index + 1}</span><span className={cn("line-clamp-2 text-[10px] font-medium leading-tight sm:text-xs lg:text-sm", index === 0 ? "text-foreground" : "text-muted-foreground")}>{title}</span></span>
              {index < steps.length - 1 && <span aria-hidden="true" className="absolute left-[calc(50%+16px)] top-[26px] hidden h-0.5 w-[calc(100%-28px)] bg-border lg:left-[15px] lg:top-[50px] lg:block lg:h-9 lg:w-0.5" />}
            </li>
          ))}
        </ol>
        <p className="hidden rounded-lg bg-muted p-3 text-xs lg:mt-auto lg:block leading-relaxed text-muted-foreground">บันทึกข้อมูลขั้นแรกเป็นฉบับร่าง แล้วตั้งค่าส่วนที่เหลือก่อนเผยแพร่</p>
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

          <EventInfoFields />
          {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error === "invalid-cover" ? "รูปปกไม่ถูกต้อง: ใช้ JPG, PNG หรือ WebP ที่มีขนาดไม่เกิน 3 MB" : "กรุณาตรวจสอบข้อมูลโครงการอีกครั้ง"}</p>}
        </main>

        <footer className="sticky bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-4 border-t bg-card px-5 py-4 shadow-[0_-4px_16px_rgb(0_0_0/0.04)] lg:px-10">
          <Button variant="outline" size="lg" asChild><Link href="/organizer">ยกเลิก</Link></Button>
          <div className="flex items-center gap-4"><span className="hidden text-sm text-muted-foreground sm:inline">ขั้นที่ 1 จาก 5</span><Button type="submit" size="lg">ถัดไป: วันที่จัด</Button></div>
        </footer>
      </div>
    </form>
  );
}
