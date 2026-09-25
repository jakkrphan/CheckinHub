import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Scanner } from "@/app/(check-in)/check-in/[eventId]/scanner";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";

import { KioskLock } from "./kiosk-lock";

export const metadata: Metadata = { title: "เช็คชื่อด้วยตนเอง" };

export default async function KioskPage({ params, searchParams }: PageProps<"/check-in/[eventId]/kiosk">) {
  const { eventId } = await params;
  const { session: sessionParam } = await searchParams;
  const { event, user } = await requireEventAccess(eventId, "checkIn");
  const session = typeof sessionParam === "string" ? await db.session.findFirst({ where: { id: sessionParam, eventId }, include: { eventDay: true } }) : null;
  if (!session) redirect(`/check-in/${eventId}`);
  const day = session.eventDay ? new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeZone: "UTC" }).format(session.eventDay.date) : "ใช้ได้ทุกวัน";

  return <main className="checkin-screen mx-auto flex min-h-svh w-full max-w-xl flex-col gap-6 bg-background px-5 py-8 text-foreground">
    <header className="flex flex-col items-center gap-1 text-center">
      <p className="text-sm text-muted-foreground">{event.title}</p>
      <h1 className="font-heading text-3xl font-bold">{session.label}</h1>
      <p className="text-sm text-muted-foreground">{day}</p>
    </header>
    <KioskLock eventId={eventId} exitHref={`/check-in/${eventId}?session=${session.id}`}>
      <p className="text-center text-lg">สแกน QR จากหน้าสถานะของคุณเพื่อเช็คชื่อ</p>
      <Scanner eventId={eventId} sessionId={session.id} operatorId={user.id} sessionLabels={{ [session.id]: session.label }} mode="kiosk" />
    </KioskLock>
  </main>;
}
