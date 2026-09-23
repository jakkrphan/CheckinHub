import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDaysIcon, ClipboardListIcon, PlusIcon, QrCodeIcon } from "lucide-react";

import { signOut } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

export default async function OrganizerPage() {
  const user = await requireOrganizerUser();
  const events = await db.event.findMany({
    where: user.role === "ADMIN" ? {} : {
      OR: [
        { ownerId: user.id },
        { organizers: { some: { userId: user.id, role: "FULL" } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      days: { orderBy: { date: "asc" }, select: { date: true } },
      _count: { select: { registrants: true } },
    },
  });

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-6 bg-sidebar px-4 py-5 text-sidebar-foreground lg:w-59">
        <Link href="/organizer" className="flex items-center gap-3 px-2 font-heading text-lg font-bold text-sidebar-foreground">
          <span className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <QrCodeIcon className="size-5" aria-hidden="true" />
          </span>
          เช็คอินอบรม
        </Link>
        <nav aria-label="เมนูหลัก" className="flex flex-wrap gap-2 lg:flex-col">
          <Link href="/organizer" aria-current="page" className="flex items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-2 text-sm font-semibold text-sidebar-accent-foreground">
            <CalendarDaysIcon className="size-5" aria-hidden="true" />
            โครงการ
          </Link>
          <Link href="/check-in" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent">
            <QrCodeIcon className="size-5" aria-hidden="true" />
            เช็คชื่อหน้างาน
          </Link>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b bg-card px-5 py-4 lg:px-8">
          <span className="text-sm text-muted-foreground">ระบบจัดการโครงการอบรม</span>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm font-medium sm:inline">{user.name}</span>
            <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
              <Button type="submit" variant="outline" size="sm">ออกจากระบบ</Button>
            </form>
          </div>
        </header>

        <main className="flex w-full flex-1 flex-col gap-6 px-5 py-8 lg:px-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <h1 className="font-heading text-3xl font-bold tracking-tight">โครงการของฉัน</h1>
              <p className="text-sm text-muted-foreground">{events.length} โครงการที่คุณมีสิทธิ์เข้าถึง</p>
            </div>
            <Button disabled title="กำลังพัฒนาการสร้างโครงการ">
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              สร้างโครงการ
            </Button>
          </div>

          {events.length === 0 ? (
            <Empty className="min-h-80 border bg-card">
              <EmptyHeader>
                <EmptyMedia variant="icon"><ClipboardListIcon aria-hidden="true" /></EmptyMedia>
                <EmptyTitle>ยังไม่มีโครงการ</EmptyTitle>
                <EmptyDescription>เมื่อมีโครงการที่คุณเป็นเจ้าของหรือผู้ร่วมจัด รายการจะแสดงที่นี่</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <section aria-label="รายการโครงการ" className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader className="bg-secondary">
                  <TableRow>
                    <TableHead className="min-w-72 px-5">โครงการ</TableHead>
                    <TableHead>วันที่จัด</TableHead>
                    <TableHead>บทบาท</TableHead>
                    <TableHead className="text-right">ลงทะเบียน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="px-5 py-4">
                        <div className="flex flex-col gap-2">
                          <span className="font-heading font-semibold whitespace-normal">{event.title}</span>
                          <span className="flex flex-wrap gap-2">
                            <Badge variant={event.status === "PUBLISHED" ? "default" : "secondary"}>{statusLabel[event.status]}</Badge>
                            <Badge variant="outline">{typeLabel[event.eventType]}</Badge>
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{event.days.length ? dateFormatter.format(event.days[0].date) : "ยังไม่กำหนด"}</TableCell>
                      <TableCell>{event.ownerId === user.id ? "เจ้าของ" : user.role === "ADMIN" ? "ผู้ดูแลระบบ" : "ผู้ร่วมจัด"}</TableCell>
                      <TableCell className="text-right tabular-nums">{event._count.registrants}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
