import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDaysIcon, CheckIcon, ChevronRightIcon, LogOutIcon, QrCodeIcon, SettingsIcon } from "lucide-react";

import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { formatEventDayList } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireActiveUser } from "@/server/authorization/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "เช็คชื่อหน้างาน" };

export default async function CheckInPage() {
  const user = await requireActiveUser();
  const events = await db.event.findMany({
    where: user.role === "ADMIN" ? { status: { in: ["PUBLISHED", "CLOSED"] }, deletedAt: null } : {
      status: { in: ["PUBLISHED", "CLOSED"] },
      deletedAt: null,
      OR: [{ ownerId: user.id }, { organizers: { some: { userId: user.id } } }],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true, location: true, days: { select: { date: true }, orderBy: { date: "asc" } }, _count: { select: { sessions: true } } },
  });
  const today = new Date(new Date().getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const keyOf = (date: Date) => date.toISOString().slice(0, 10);
  // Today's events first, then upcoming by their next day, then finished ones (most recent first).
  const ranked = events.map((event) => {
    const keys = event.days.map((day) => keyOf(day.date));
    const next = keys.find((key) => key >= today);
    return { event, isToday: keys.includes(today), next, last: keys.at(-1) ?? "" };
  }).sort((a, b) => Number(b.isToday) - Number(a.isToday) || (a.next && b.next ? a.next.localeCompare(b.next) : a.next ? -1 : b.next ? 1 : b.last.localeCompare(a.last)));

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return <main className="flex-1">
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 py-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><QrCodeIcon className="size-5" aria-hidden="true" /></span><div className="flex flex-col leading-tight"><h1 className="font-heading text-lg font-bold">เช็คชื่อหน้างาน</h1><span className="text-xs text-muted-foreground">{user.name}</span></div></div>
        <div className="flex items-center gap-2">
          {user.role !== "STAFF" && <Button asChild variant="secondary" size="icon-lg" className="size-11"><Link href="/organizer" aria-label="ไปหน้าจัดการโครงการ"><SettingsIcon aria-hidden="true" /></Link></Button>}
          <form action={logout}><Button type="submit" variant="secondary" className="h-11"><LogOutIcon data-icon="inline-start" aria-hidden="true" />ออกจากระบบ</Button></form>
        </div>
      </header>
      <p className="text-sm text-muted-foreground">เลือกโครงการที่จะเช็คชื่อ · โครงการที่จัดวันนี้แสดงก่อน</p>
      {ranked.length === 0 ? <div className="flex flex-col items-center gap-2 rounded-2xl bg-card px-5 py-10 text-center"><CalendarDaysIcon className="size-8 text-muted-foreground" aria-hidden="true" /><p className="font-semibold">ยังไม่มีโครงการที่เปิดให้เช็คชื่อ</p><p className="text-sm text-muted-foreground">ผู้จัดต้องเผยแพร่โครงการและเพิ่มคุณเป็นผู้ร่วมจัดก่อน</p></div>
        : <ul className="flex flex-col gap-3">{ranked.map(({ event, isToday, next }) => <li key={event.id}>
          <Link href={`/check-in/${event.id}`} className={cn("flex min-h-20 items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 hover:border-primary/60", isToday && "border-primary")}>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-1.5">
                {isToday && <span className="flex items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground"><CheckIcon className="size-3" aria-hidden="true" />จัดวันนี้</span>}
                {event.status === "CLOSED" && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">ปิดรับสมัครแล้ว</span>}
                {!isToday && !next && event.days.length > 0 && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">จบแล้ว</span>}
              </span>
              <span className="font-heading font-bold leading-snug">{event.title}</span>
              <span className="text-xs text-muted-foreground">{event.days.length ? formatEventDayList(event.days.map((day) => day.date)) : "ยังไม่มีวันจัด"} · {event._count.sessions} รอบ{event.location ? ` · ${event.location}` : ""}</span>
            </span>
            <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>)}</ul>}
    </div>
  </main>;
}
