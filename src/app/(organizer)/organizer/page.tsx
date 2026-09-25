import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ClipboardListIcon, ImageIcon, PlusIcon, SearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { requireOrganizerUser } from "@/server/authorization/session";
import { db } from "@/server/db";

export const metadata: Metadata = {
  title: "โครงการของฉัน",
};

const statusLabel = {
  DRAFT: "ฉบับร่าง",
  PUBLISHED: "เผยแพร่แล้ว",
  CLOSED: "ปิดรับแล้ว",
} as const;

const typeLabel = {
  INTERNAL: "ภายใน",
  EXTERNAL: "ภายนอก",
  MIXED: "ผสม",
} as const;

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function EventRegistrationSummary({
  status,
  total,
  days,
  occupiedSeatsByDay,
}: {
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  total: number;
  days: { id: string; maxSeats: number | null }[];
  occupiedSeatsByDay: ReadonlyMap<string, number>;
}) {
  const capacity = days.reduce((sum, day) => sum + (day.maxSeats ?? 0), 0);
  const unlimitedDays = days.some((day) => day.maxSeats === null);
  const occupied = days.reduce((sum, day) => sum + (occupiedSeatsByDay.get(day.id) ?? 0), 0);
  const fill = capacity > 0 && !unlimitedDays ? Math.min(100, Math.round(occupied / capacity * 100)) : null;

  return <div className="flex flex-col gap-1.5 tabular-nums">
    <div className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold">{total.toLocaleString("th-TH")} คน</span><span className="text-xs text-muted-foreground">{days.length} วัน</span></div>
    {status === "DRAFT" ? <span className="text-xs text-muted-foreground">ยังไม่เผยแพร่</span> : fill !== null ? <div className="flex flex-col gap-1" aria-label={`ใช้ที่นั่ง ${occupied} จาก ${capacity}`}><div role="progressbar" aria-label="สัดส่วนที่นั่งที่ถูกจอง" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${fill}%` }} /></div><span className="text-xs text-muted-foreground">{occupied.toLocaleString("th-TH")} / {capacity.toLocaleString("th-TH")} ที่นั่ง</span></div> : days.length > 0 ? <span className="text-xs text-muted-foreground">{occupied.toLocaleString("th-TH")} ที่นั่ง · {unlimitedDays ? "มีวันที่ไม่จำกัด" : "ไม่จำกัดที่นั่ง"}</span> : <span className="text-xs text-muted-foreground">ยังไม่มีวันจัด</span>}
  </div>;
}

function EventActionBadges({ pending, waitlisted }: { pending: number; waitlisted: number }) {
  if (!pending && !waitlisted) return <span className="text-sm text-muted-foreground">—</span>;
  return <div className="flex max-w-40 flex-wrap gap-1">
    {pending > 0 && <Badge variant="secondary" className="bg-amber-100 text-amber-900">รออนุมัติ {pending.toLocaleString("th-TH")}</Badge>}
    {waitlisted > 0 && <Badge variant="secondary">รอคิว {waitlisted.toLocaleString("th-TH")}</Badge>}
  </div>;
}

export default async function OrganizerPage({ searchParams }: PageProps<"/organizer">) {
  const user = await requireOrganizerUser();
  const params = await searchParams;
  const status = typeof params.status === "string" && ["DRAFT", "PUBLISHED", "CLOSED"].includes(params.status) ? params.status : "ALL";
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const events = await db.event.findMany({
    where: user.role === "ADMIN" ? { deletedAt: null } : {
      deletedAt: null,
      OR: [
        { ownerId: user.id },
        { organizers: { some: { userId: user.id, role: "FULL" } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      days: { orderBy: { date: "asc" }, select: { id: true, date: true, maxSeats: true } },
      _count: { select: { registrants: true } },
    },
  });
  const eventIds = events.map((event) => event.id);
  const eventDayIds = events.flatMap((event) => event.days.map((day) => day.id));
  const [registrationStatusCounts, occupiedSeatCounts] = await Promise.all([
    eventIds.length ? db.registrant.groupBy({
      by: ["eventId", "status"],
      where: { eventId: { in: eventIds } },
      _count: { _all: true },
    }) : Promise.resolve([]),
    eventDayIds.length ? db.registrantEventDay.groupBy({
      by: ["eventDayId"],
      where: { eventDayId: { in: eventDayIds }, status: { in: ["PENDING", "APPROVED"] } },
      _count: { _all: true },
    }) : Promise.resolve([]),
  ]);
  const registrationCountsByEvent = new Map<string, { pending: number; waitlisted: number }>();
  for (const item of registrationStatusCounts) {
    const counts = registrationCountsByEvent.get(item.eventId) ?? { pending: 0, waitlisted: 0 };
    if (item.status === "PENDING") counts.pending = item._count._all;
    if (item.status === "WAITLISTED") counts.waitlisted = item._count._all;
    registrationCountsByEvent.set(item.eventId, counts);
  }
  const occupiedSeatsByDay = new Map(occupiedSeatCounts.map((item) => [item.eventDayId, item._count._all]));
  const filteredEvents = events.filter((event) =>
    (status === "ALL" || event.status === status) &&
    (!query || event.title.toLocaleLowerCase("th-TH").includes(query.toLocaleLowerCase("th-TH")))
  );
  const statusFilters = [
    { value: "ALL", label: "ทั้งหมด", count: events.length },
    { value: "DRAFT", label: "ฉบับร่าง", count: events.filter((event) => event.status === "DRAFT").length },
    { value: "PUBLISHED", label: "เผยแพร่", count: events.filter((event) => event.status === "PUBLISHED").length },
    { value: "CLOSED", label: "ปิดรับ", count: events.filter((event) => event.status === "CLOSED").length },
  ];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-5 py-8 lg:px-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <h1 className="font-heading text-3xl font-bold tracking-tight">โครงการของฉัน</h1>
              <p className="text-sm text-muted-foreground">{events.length} โครงการที่คุณมีสิทธิ์เข้าถึง</p>
            </div>
            {user.role !== "STAFF" && <Button asChild>
              <Link href="/organizer/new"><PlusIcon data-icon="inline-start" aria-hidden="true" />สร้างโครงการ</Link>
            </Button>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <nav aria-label="กรองสถานะโครงการ" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
              {statusFilters.map((filter) => (
                <Link key={filter.value} href={`/organizer?status=${filter.value}${query ? `&q=${encodeURIComponent(query)}` : ""}`} aria-current={status === filter.value ? "page" : undefined} className={cn("rounded-md px-3 py-2 text-sm", status === filter.value ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {filter.label} {filter.count}
                </Link>
              ))}
            </nav>
            <form method="get" className="flex items-center gap-2">
              {status !== "ALL" && <input type="hidden" name="status" value={status} />}
              <label htmlFor="project-search" className="sr-only">ค้นหาชื่อโครงการ</label>
              <Input id="project-search" name="q" defaultValue={query} maxLength={100} placeholder="ค้นหาชื่อโครงการ" className="w-56 sm:w-72" />
              <Button type="submit" variant="outline" size="icon" aria-label="ค้นหา"><SearchIcon aria-hidden="true" /></Button>
            </form>
          </div>

          {filteredEvents.length === 0 ? (
            <Empty className="min-h-80 border bg-card">
              <EmptyHeader>
                <EmptyMedia variant="icon"><ClipboardListIcon aria-hidden="true" /></EmptyMedia>
                <EmptyTitle>{events.length ? "ไม่พบโครงการที่ตรงเงื่อนไข" : "ยังไม่มีโครงการ"}</EmptyTitle>
                <EmptyDescription>{events.length ? "ลองเปลี่ยนสถานะหรือคำค้นหา" : "เมื่อมีโครงการที่คุณเป็นเจ้าของหรือผู้ร่วมจัด รายการจะแสดงที่นี่"}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <section aria-label="รายการโครงการ" className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader className="bg-secondary">
                  <TableRow>
                    <TableHead className="px-5">ปก</TableHead>
                    <TableHead className="min-w-72">โครงการ</TableHead>
                    <TableHead className="min-w-40">วันที่จัด</TableHead>
                    <TableHead>บทบาท</TableHead>
                    <TableHead className="min-w-48">ลงทะเบียน</TableHead>
                    <TableHead className="min-w-36">ต้องจัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEvents.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="px-5 py-4"><div className="relative flex h-14 w-24 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">{event.coverImageUrl ? <Image src={event.coverImageUrl} alt="" fill unoptimized sizes="96px" className="object-cover" /> : <div className="flex flex-col items-center gap-1"><ImageIcon className="size-5" aria-hidden="true" /><span className="text-[10px]">รูปปก</span></div>}</div></TableCell>
                      <TableCell className="py-4">
                        <div className="flex flex-col gap-2">
                          <Link href={`/organizer/${event.id}/dashboard`} className="font-heading font-semibold whitespace-normal hover:underline">{event.title}</Link>
                          <span className="flex flex-wrap gap-2">
                            <Badge variant="secondary" className={event.status === "PUBLISHED" ? "bg-accent text-accent-foreground" : event.status === "DRAFT" ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground"}>{statusLabel[event.status]}</Badge>
                            <Badge variant="outline">{typeLabel[event.eventType]}</Badge>
                            <Badge variant="outline">{event.autoApprove ? "อนุมัติอัตโนมัติ" : "อนุมัติเอง"}</Badge>
                          </span>
                        </div>
                      </TableCell>
                      <TableCell><div className="flex flex-wrap gap-1">{event.days.length ? event.days.slice(0, 3).map((day) => <span key={day.id} className="rounded-md border bg-background px-2 py-1 text-xs font-medium">{dateFormatter.format(day.date)}</span>) : "ยังไม่กำหนด"}{event.days.length > 3 && <span className="text-xs text-muted-foreground">+{event.days.length - 3} วัน</span>}</div></TableCell>
                      <TableCell>{event.ownerId === user.id ? "เจ้าของ" : user.role === "ADMIN" ? "ผู้ดูแลระบบ" : "ผู้ร่วมจัด"}</TableCell>
                      <TableCell><EventRegistrationSummary status={event.status} total={event._count.registrants} days={event.days} occupiedSeatsByDay={occupiedSeatsByDay} /></TableCell>
                      <TableCell>{(() => {
                        const counts = registrationCountsByEvent.get(event.id) ?? { pending: 0, waitlisted: 0 };
                        return <EventActionBadges pending={counts.pending} waitlisted={counts.waitlisted} />;
                      })()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
    </main>
  );
}
