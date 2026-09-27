import { AutoRefresh } from "@/components/auto-refresh";
import { EventOverviewPanels } from "@/components/event-overview-panels";
import { formatDateTime, formatEventDay } from "@/lib/format";
import { requireEventAccess } from "@/server/authorization/event";
import { canManageEvent } from "@/server/authorization/policy";
import { db } from "@/server/db";
import { getEventOverview } from "@/server/events/overview";
import { getWaitlistOpenings } from "@/server/registrations/waitlist-openings";

import { OrganizerEventHeader } from "../event-header";
import { WaitlistOpenings } from "../waitlist-openings";

export default async function DashboardPage({ params, searchParams }: PageProps<"/organizer/[eventId]/dashboard">) {
  const { eventId } = await params;
  const { promoted } = await searchParams;
  const { event, membership } = await requireEventAccess(eventId, "view");
  const [overview, recent, openings] = await Promise.all([
    getEventOverview(event),
    db.checkIn.findMany({ where: { session: { eventId }, voidedAt: null }, orderBy: { syncedAt: "desc" }, take: 10, select: { id: true, checkedInAt: true, method: true, isOverride: true, session: { select: { label: true, eventDay: { select: { date: true } } } } } }),
    getWaitlistOpenings(event),
  ]);

  return <>
    <OrganizerEventHeader event={event} activeTab="overview" />
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 lg:px-10">
      <AutoRefresh intervalMs={5000} />
      <h2 className="sr-only">ภาพรวมการลงทะเบียนและเช็คชื่อ</h2>
      {promoted === "1" && <p role="status" className="rounded-lg border border-primary/30 bg-accent px-4 py-3 text-sm text-accent-foreground">เลื่อนคิวถัดไปแล้ว</p>}
      {promoted === "0" && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">ไม่ได้เลื่อนคิว: ที่นั่งเต็มแล้วหรือไม่มีคนรอคิว (อาจมีผู้จัดคนอื่นเลื่อนไปก่อน)</p>}
      <WaitlistOpenings eventId={eventId} openings={openings} canManage={canManageEvent(membership) && !event.anonymizedAt} returnTo={`/organizer/${eventId}/dashboard`} />
      <EventOverviewPanels overview={overview} seatMode={event.seatMode} registrantsHref={`/organizer/${eventId}/registrants`}
        aside={<span className="flex items-center gap-2 text-sm text-muted-foreground"><span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />อัปเดตอัตโนมัติทุก 5 วินาที</span>} />
      <section className="rounded-xl border bg-card p-5" aria-labelledby="recent-checkins">
        <h2 id="recent-checkins" className="font-heading text-lg font-bold">เช็คชื่อล่าสุด</h2>
        <div className="mt-2 flex flex-col divide-y text-sm">{recent.length ? recent.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <span>{entry.session.label}{entry.session.eventDay ? ` · ${formatEventDay(entry.session.eventDay.date)}` : ""}{entry.isOverride && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-900">กรณีพิเศษ</span>}{entry.method === "kiosk" && <span className="ml-2 rounded bg-muted px-1.5 text-xs">kiosk</span>}</span>
          <time className="text-muted-foreground" dateTime={entry.checkedInAt.toISOString()}>{formatDateTime(entry.checkedInAt)}</time>
        </div>) : <p className="py-3 text-muted-foreground">ยังไม่มีการเช็คชื่อ</p>}</div>
      </section>
    </main>
  </>;
}
