import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import Script from "next/script";
import { ImageIcon, LockKeyholeIcon, MapPinIcon } from "lucide-react";

import { PublicRegistrationWizard } from "@/app/(public)/events/[slug]/public-registration-wizard";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { readRegistrationFields, validateRegistrationFields } from "@/features/events/registration-fields";
import { db } from "@/server/db";
import { getSeatAvailability } from "@/server/registrations/day-status";
import { issueFormTicket } from "@/server/registrations/form-ticket";

export const metadata: Metadata = {
  title: "ลงทะเบียนอบรม",
};

export default async function PublicEventPage({
  params,
  searchParams,
}: PageProps<"/events/[slug]">) {
  const { slug } = await params;
  const { error } = await searchParams;
  const event = await db.event.findUnique({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      title: true,
      coverImageUrl: true,
      description: true,
      location: true,
      eventType: true,
      autoApprove: true,
      seatMode: true,
      maxSeats: true,
      attendanceThreshold: true,
      status: true,
      registrationDeadline: true,
      fields: true,
      days: { orderBy: { date: "asc" }, select: { id: true, date: true, maxSeats: true, isClosed: true } },
    },
  });

  if (!event) notFound();

  if (event.status === "DRAFT") {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-lg md:my-10 md:min-h-0 md:max-w-xl md:overflow-clip md:rounded-2xl md:border md:shadow-sm lg:max-w-2xl bg-background">
        <Empty className="rounded-none border-0 px-6 py-8">
          <EmptyHeader>
            <EmptyMedia variant="hero"><LockKeyholeIcon aria-hidden="true" /></EmptyMedia>
            <EmptyTitle size="hero">ยังไม่เปิดรับลงทะเบียน</EmptyTitle>
            <EmptyDescription>โครงการนี้ยังเป็นฉบับร่าง ผู้จัดยังไม่กดเผยแพร่<br />กรุณากลับมาใหม่ภายหลัง หรือสอบถามผู้จัดโครงการ</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><p className="text-xs text-muted-foreground">{event.title}</p></EmptyContent>
        </Empty>
      </main>
    );
  }

  const closed = event.status === "CLOSED" || (event.registrationDeadline !== null && event.registrationDeadline <= new Date());
  const dateFormatter = new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  const fields = readRegistrationFields(event.fields);
  const available = !closed && !!event.registrationDeadline && event.days.some((day) => event.seatMode === "whole_course" || !day.isClosed) && validateRegistrationFields(fields)
    && fields.every((field) => field.type !== "file" || process.env.NODE_ENV !== "production");
  const availability = await getSeatAvailability(db, event, event.days.map((day) => day.id));
  const days = event.days.map((day) => {
    return {
      id: day.id,
      date: day.date.toISOString().slice(0, 10),
      label: dateFormatter.format(day.date),
      maxSeats: day.maxSeats,
      isClosed: day.isClosed,
      remaining: availability.mode === "per_day" ? availability.days.get(day.id)?.remaining ?? null : null,
    };
  });
  const captchaSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const deadline = event.registrationDeadline ? new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(event.registrationDeadline) : "ยังไม่กำหนด";
  const errorMessage: Record<string, string> = {
    "not-open": "โครงการนี้ยังไม่เปิดรับลงทะเบียน",
    invalid: "กรุณาตรวจสอบข้อมูล วันที่เลือก และการยินยอมก่อนส่ง",
    duplicate: "อีเมลนี้ลงทะเบียนโครงการนี้แล้ว กรุณาใช้ลิงก์สถานะที่ได้รับตอนลงทะเบียน",
    "rate-limited": "ส่งใบสมัครบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
    captcha: "การยืนยันตัวตนไม่ผ่าน กรุณาลองใหม่",
    unavailable: "ระบบลงทะเบียนยังไม่พร้อม กรุณาลองใหม่ภายหลัง",
    "too-fast": "ระบบตรวจพบการส่งเร็วผิดปกติ กรุณาตรวจสอบข้อมูลแล้วส่งอีกครั้ง",
    expired: "หน้าฟอร์มเปิดค้างไว้นานเกินไป กรุณากรอกและส่งใหม่อีกครั้ง",
  };

  const typeLabel = event.eventType === "INTERNAL" ? "ภายใน" : event.eventType === "EXTERNAL" ? "ภายนอก" : "ผสม";
  const cover = event.coverImageUrl ? <div className="relative aspect-[16/6] min-h-44 bg-muted"><Image src={event.coverImageUrl} alt={`รูปปก ${event.title}`} fill priority unoptimized className="object-cover" sizes="(max-width: 480px) 100vw, 480px" /></div> : <div role="img" aria-label="พื้นที่รูปปกโครงการ" className="flex aspect-[16/6] min-h-44 flex-col items-center justify-center gap-2 bg-muted text-muted-foreground"><ImageIcon className="size-8" aria-hidden="true" /><span className="text-sm">รูปปกโครงการ</span></div>;
  const details = (event.description || event.location) ? <div className="flex flex-col gap-2">{event.description && <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{event.description}</p>}{event.location && <p className="flex items-center gap-2 text-xs text-muted-foreground"><MapPinIcon className="size-4 shrink-0" aria-hidden="true" />{event.location}</p>}</div> : null;
  const notice = typeof error === "string" && errorMessage[error] ? errorMessage[error] : null;

  if (available) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-lg md:my-10 md:min-h-0 md:max-w-xl md:overflow-clip md:rounded-2xl md:border md:shadow-sm lg:max-w-2xl flex-col bg-background shadow-sm">
        {captchaSiteKey && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" async defer />}
        <PublicRegistrationWizard slug={slug} formTicket={issueFormTicket()} fields={fields} days={days} captchaSiteKey={captchaSiteKey} deadline={deadline} autoApprove={event.autoApprove} seatMode={event.seatMode} courseRemaining={availability.mode === "whole_course" ? availability.remaining : null} courseMaxSeats={event.maxSeats} attendanceThreshold={event.attendanceThreshold} title={event.title} typeLabel={typeLabel} cover={cover} details={details} notice={notice} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg md:my-10 md:min-h-0 md:max-w-xl md:overflow-clip md:rounded-2xl md:border md:shadow-sm lg:max-w-2xl flex-col bg-background shadow-sm">
      {cover}
      <div className="flex flex-col gap-3 border-b bg-card px-5 py-5">
        <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">โครงการอบรม</p><Badge variant="secondary" className="rounded-md bg-muted font-semibold">{typeLabel}</Badge></div>
        <h1 className="font-heading text-xl font-bold leading-snug">{event.title}</h1>
        {details}
      </div>
      {closed ? (
        <p role="status" className="m-5 rounded-xl border bg-card p-5 font-medium">ปิดรับลงทะเบียนแล้ว</p>
      ) : <p role="status" className="m-5 rounded-xl border bg-card p-5 text-sm">{event.days.length > 0 && event.days.every((day) => day.isClosed) ? "ปิดรับลงทะเบียนทุกวันแล้ว" : "ยังไม่พร้อมรับลงทะเบียนออนไลน์"}</p>}
    </main>
  );
}
