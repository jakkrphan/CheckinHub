import Link from "next/link";

import { requireActiveUser } from "@/server/authorization/session";
import { db } from "@/server/db";

export default async function CheckInPage() {
  const user = await requireActiveUser();
  const events = await db.event.findMany({
    where: user.role === "ADMIN" ? { status: { in: ["PUBLISHED", "CLOSED"] }, deletedAt: null } : {
      status: { in: ["PUBLISHED", "CLOSED"] },
      deletedAt: null,
      OR: [{ ownerId: user.id }, { organizers: { some: { userId: user.id } } }],
    },
    orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true },
  });
  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-10">
    <h1 className="font-heading text-3xl font-bold">เช็คชื่อหน้างาน</h1>
    <p className="text-muted-foreground">เลือกโครงการที่คุณมีสิทธิ์เช็คชื่อ</p>
    {events.length === 0 && <p className="rounded-xl border p-6">ยังไม่มีโครงการที่เปิดให้เช็คชื่อ</p>}
    {events.map((event) => <Link key={event.id} href={`/check-in/${event.id}`} className="rounded-xl border bg-card p-5 font-medium hover:bg-accent">{event.title} →</Link>)}
  </main>;
}
