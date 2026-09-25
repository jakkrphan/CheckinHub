import Link from "next/link";
import { CalendarDaysIcon, ChevronLeftIcon, MapPinIcon } from "lucide-react";

import { formatDeadlineDay, formatEventDayList } from "@/lib/format";
import { cn } from "@/lib/utils";
import { db } from "@/server/db";

const typeLabel = { INTERNAL: "ภายใน", EXTERNAL: "ภายนอก", MIXED: "ผสม" } as const;
const tabs = [
  { value: "overview", label: "ภาพรวม", href: (id: string) => `/organizer/${id}/dashboard` },
  { value: "registrants", label: "ผู้ลงทะเบียน", href: (id: string) => `/organizer/${id}/registrants` },
  { value: "settings", label: "ตั้งค่า", href: (id: string) => `/organizer/${id}?step=1` },
] as const;

type EventHeaderData = {
  id: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  eventType: keyof typeof typeLabel;
  autoApprove: boolean;
  location: string | null;
  registrationDeadline: Date | null;
};

/** Status chip text that tells the organizer at a glance whether registration is actually open right now. */
function statusChip(event: EventHeaderData) {
  if (event.status === "DRAFT") return { text: "ฉบับร่าง", className: "bg-amber-100 text-amber-900" };
  if (event.status === "CLOSED") return { text: "ปิดรับแล้ว", className: "bg-muted text-muted-foreground" };
  if (event.registrationDeadline && event.registrationDeadline <= new Date()) return { text: "เลยวันปิดรับ", className: "bg-muted text-muted-foreground" };
  return { text: `เปิดรับ${event.registrationDeadline ? ` · ปิด ${formatDeadlineDay(event.registrationDeadline)}` : ""}`, className: "bg-accent text-accent-foreground" };
}

export async function OrganizerEventHeader({ event, activeTab, actions }: { event: EventHeaderData; activeTab: (typeof tabs)[number]["value"]; actions?: React.ReactNode }) {
  const days = await db.eventDay.findMany({ where: { eventId: event.id }, orderBy: { date: "asc" }, select: { date: true } });
  const chip = statusChip(event);

  return (
    <section className="border-b bg-card">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-5 pt-6 lg:px-10">
        <Link href="/organizer" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeftIcon className="size-4" aria-hidden="true" />โครงการของฉัน</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2.5">
            <h1 className="font-heading text-2xl font-bold leading-snug">{event.title}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", chip.className)}>{chip.text}</span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">{typeLabel[event.eventType]}</span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">{event.autoApprove ? "อนุมัติอัตโนมัติ" : "อนุมัติเอง"}</span>
              {days.length > 0 && <span className="flex items-center gap-1"><CalendarDaysIcon className="size-4" aria-hidden="true" />{formatEventDayList(days.map(({ date }) => date))}</span>}
              {event.location && <span className="flex items-center gap-1"><MapPinIcon className="size-4" aria-hidden="true" />{event.location}</span>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
        <nav aria-label="เมนูโครงการ" className="flex gap-6 overflow-x-auto">
          {tabs.map((tab) => <Link key={tab.value} href={tab.href(event.id)} aria-current={activeTab === tab.value ? "page" : undefined}
            className={cn("shrink-0 border-b-2 px-1 py-3 text-sm", activeTab === tab.value ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{tab.label}</Link>)}
        </nav>
      </div>
    </section>
  );
}
