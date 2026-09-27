import Link from "next/link";
import { ArrowUpIcon, UsersRoundIcon } from "lucide-react";

import { promoteFromWaitlist } from "@/app/(organizer)/organizer/[eventId]/registrants/actions";
import { Button } from "@/components/ui/button";
import type { WaitlistOpening } from "@/server/registrations/waitlist-openings";

/**
 * Manual waitlist mode: tells organizers which queue has a free seat and who is next, with a button to move that
 * person up. Read-only for check-in-only members.
 */
export function WaitlistOpenings({ eventId, openings, canManage, returnTo }: { eventId: string; openings: WaitlistOpening[]; canManage: boolean; returnTo: string }) {
  if (!openings.length) return null;
  const promote = promoteFromWaitlist.bind(null, eventId);
  return <section aria-labelledby="waitlist-openings-title" className="flex flex-col gap-3 rounded-xl border border-orange-300 bg-orange-50 p-4 text-orange-950">
    <div className="flex items-start gap-2.5">
      <UsersRoundIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <h2 id="waitlist-openings-title" className="font-semibold">มีที่นั่งว่างและมีคนรอคิว</h2>
        <p className="text-sm">โครงการนี้ตั้งให้ผู้จัดเลื่อนคิวเอง — กดเลื่อนคิวถัดไปตามลำดับ หรือเปิดดูรายชื่อแล้วอนุมัติคนที่ต้องการ</p>
      </div>
    </div>
    <ul className="flex flex-col divide-y divide-orange-200 rounded-lg border border-orange-200 bg-card text-card-foreground">
      {openings.map((opening) => <li key={opening.eventDayId ?? "course"} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="min-w-0 text-sm">
          <strong className="font-semibold">{opening.label}</strong> ว่าง {opening.free === null ? "ไม่จำกัด" : `${opening.free.toLocaleString("th-TH")} ที่`} · รอคิว {opening.waiting.toLocaleString("th-TH")} คน
          <span className="block text-muted-foreground">คิวถัดไป: <Link href={`/organizer/${eventId}/registrants?status=WAITLISTED&selected=${opening.next.id}`} className="font-medium text-foreground underline-offset-4 hover:underline [overflow-wrap:anywhere]">{opening.next.name}</Link></span>
        </p>
        {canManage && <form action={promote} className="shrink-0">
          <input type="hidden" name="dayId" value={opening.eventDayId ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button type="submit" size="sm" className="w-full sm:w-auto"><ArrowUpIcon data-icon="inline-start" aria-hidden="true" />เลื่อนคิวถัดไป</Button>
        </form>}
      </li>)}
    </ul>
  </section>;
}
