import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Scanner } from "@/app/(check-in)/check-in/[eventId]/scanner";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";
import { getFeatureFlags } from "@/server/settings/features";

import { KioskLock } from "./kiosk-lock";

export const metadata: Metadata = { title: "เช็คชื่อด้วยตนเอง" };

export default async function KioskPage({ params, searchParams }: PageProps<"/check-in/[eventId]/kiosk">) {
  // Admin switch in /admin?view=settings (off by default until a "forgot PIN" flow exists).
  const flags = await getFeatureFlags();
  if (!flags.kiosk) notFound();
  const { eventId } = await params;
  const { session: sessionParam } = await searchParams;
  const { event, user } = await requireEventAccess(eventId, "checkIn");
  const session = typeof sessionParam === "string" ? await db.session.findFirst({ where: { id: sessionParam, eventId }, include: { eventDay: true } }) : null;
  if (!session) redirect(`/check-in/${eventId}`);
  const day = session.eventDay ? new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeZone: "UTC" }).format(session.eventDay.date) : "ใช้ได้ทุกวัน";

  return <main className="checkin-dark mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 bg-background px-5 py-8 text-foreground md:max-w-4xl [@media(orientation:landscape)_and_(max-height:540px)]:max-w-4xl [@media(orientation:landscape)_and_(max-height:540px)]:gap-3 [@media(orientation:landscape)_and_(max-height:540px)]:py-4">
    <header className="flex flex-col items-center gap-1 text-center">
      <p className="text-sm text-muted-foreground">{event.title}</p>
      <h1 className="font-heading text-3xl font-bold">{session.label}</h1>
      <p className="text-sm text-muted-foreground">{day}</p>
    </header>
    <KioskLock eventId={eventId} exitHref={`/check-in/${eventId}?session=${session.id}`}>
      <p className="text-center text-lg">สแกน QR จากหน้าสถานะของคุณเพื่อเช็คชื่อ</p>
      <Scanner eventId={eventId} sessionId={session.id} operatorId={user.id} sessionLabels={{ [session.id]: session.label }} sessionTitle={session.label} mode="kiosk" allowCamera={flags.cameraScan} />
    </KioskLock>
  </main>;
}
