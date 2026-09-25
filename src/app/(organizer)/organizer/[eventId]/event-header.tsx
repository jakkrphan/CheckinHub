import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { db } from "@/server/db";

const statusLabel = { DRAFT: "ฉบับร่าง", PUBLISHED: "เปิดรับสมัคร", CLOSED: "ปิดรับสมัคร" } as const;
const typeLabel = { INTERNAL: "ภายใน", EXTERNAL: "ภายนอก", MIXED: "ผสม" } as const;
const tabs = [
  { value: "overview", label: "ภาพรวม", href: (id: string) => `/organizer/${id}/dashboard` },
  { value: "registrants", label: "ผู้ลงทะเบียน", href: (id: string) => `/organizer/${id}/registrants` },
  { value: "settings", label: "ตั้งค่า", href: (id: string) => `/organizer/${id}?step=1` },
] as const;

type EventHeaderData = {
  id: string;
  title: string;
  status: keyof typeof statusLabel;
  eventType: keyof typeof typeLabel;
  autoApprove: boolean;
  location: string | null;
  registrationDeadline: Date | null;
};

export async function OrganizerEventHeader({
  event,
  activeTab,
  actions,
}: {
  event: EventHeaderData;
  activeTab: (typeof tabs)[number]["value"];
  actions?: React.ReactNode;
}) {
  const days = await db.eventDay.findMany({ where: { eventId: event.id }, orderBy: { date: "asc" }, select: { date: true } });
  const dateLabel = (date: Date) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);

  return (
    <section className="border-b bg-card">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-5 lg:px-10">
        <Link href="/organizer" className="w-fit text-xs text-muted-foreground hover:text-foreground">โครงการของฉัน</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-bold leading-snug">{event.title}</h1>
              <Badge variant={event.status === "PUBLISHED" ? "default" : "secondary"}>{statusLabel[event.status]}</Badge>
              <Badge variant="outline">{typeLabel[event.eventType]}</Badge>
              <Badge variant="outline">{event.autoApprove ? "อนุมัติอัตโนมัติ" : "อนุมัติเอง"}</Badge>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {event.registrationDeadline && <span>ปิดรับ {dateLabel(event.registrationDeadline)}</span>}
              {days.length > 0 && <span>{days.map(({ date }) => dateLabel(date)).join(" · ")}</span>}
              {event.location && <span>{event.location}</span>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
        <nav aria-label="เมนูโครงการ" className="-mb-5 flex gap-5 overflow-x-auto border-b">
          {tabs.map((tab) => <Link key={tab.value} href={tab.href(event.id)} aria-current={activeTab === tab.value ? "page" : undefined} className={`shrink-0 border-b-2 px-1 py-3 text-sm ${activeTab === tab.value ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{tab.label}</Link>)}
        </nav>
      </div>
    </section>
  );
}