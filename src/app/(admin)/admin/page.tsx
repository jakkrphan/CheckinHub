import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdminUser } from "@/server/authorization/session";
import { db } from "@/server/db";

import { createUser, issuePasswordLink, toggleUserActive, updateUserDetails, updateUserRole } from "./actions";

export const metadata: Metadata = { title: "ผู้ดูแลระบบ" };

const roleLabel = { ADMIN: "ผู้ดูแลระบบ", ORGANIZER: "ผู้จัดโครงการ", STAFF: "เจ้าหน้าที่" } as const;
const dateFormatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const AUDIT_PAGE_SIZE = 200;

/** Parses a yyyy-mm-dd filter as a Bangkok calendar day boundary. */
function bangkokDay(value: unknown, endOfDay: boolean) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+07:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const actor = await requireAdminUser();
  const params = await searchParams;
  const view = params.view === "events" || params.view === "audit" ? params.view : "users";
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const auditActor = typeof params.actor === "string" ? params.actor.trim().slice(0, 100) : "";
  const auditEvent = typeof params.event === "string" ? params.event.trim().slice(0, 100) : "";
  const auditScope = params.scope === "system" || params.scope === "event" ? params.scope : "all";
  const auditFrom = bangkokDay(params.from, false);
  const auditTo = bangkokDay(params.to, true);
  const auditWhere = {
    ...(auditActor ? { actor: { OR: [{ name: { contains: auditActor } }, { email: { contains: auditActor } }] } } : {}),
    ...(auditScope === "system" ? { eventId: null } : auditEvent ? { event: { OR: [{ title: { contains: auditEvent } }, { slug: { contains: auditEvent } }, { id: auditEvent }] } } : auditScope === "event" ? { eventId: { not: null } } : {}),
    ...(auditFrom || auditTo ? { createdAt: { ...(auditFrom ? { gte: auditFrom } : {}), ...(auditTo ? { lte: auditTo } : {}) } } : {}),
  };
  const [users, events, logs, counts] = await Promise.all([
    view === "users" ? db.user.findMany({
      where: query ? { OR: [{ name: { contains: query } }, { email: { contains: query } }] } : undefined,
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: { id: true, name: true, email: true, role: true, isActive: true, passwordHash: true, createdAt: true, _count: { select: { ownedEvents: true, organizerOf: true } } },
    }) : Promise.resolve([]),
    view === "events" ? db.event.findMany({
      where: query ? { OR: [{ title: { contains: query } }, { slug: { contains: query } }] } : undefined,
      orderBy: { updatedAt: "desc" }, take: 100,
      select: { id: true, title: true, slug: true, status: true, deletedAt: true, updatedAt: true, owner: { select: { name: true, email: true } }, _count: { select: { registrants: true, organizers: true } } },
    }) : Promise.resolve([]),
    view === "audit" ? db.auditLog.findMany({
      where: auditWhere, orderBy: { createdAt: "desc" }, take: AUDIT_PAGE_SIZE,
      include: { actor: { select: { name: true, email: true } }, event: { select: { id: true, title: true } } },
    }) : Promise.resolve([]),
    Promise.all([db.user.count(), db.event.count(), view === "audit" ? db.auditLog.count({ where: auditWhere }) : db.auditLog.count()]),
  ]);

  const tabs = [
    { value: "users", label: "ผู้ใช้ในระบบ", count: counts[0] },
    { value: "events", label: "โครงการทั้งหมด", count: counts[1] },
    { value: "audit", label: "Audit log", count: counts[2] },
  ];

  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 lg:px-10">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">ระบบ / ผู้ดูแลระบบ</p>
        <h1 className="font-heading text-3xl font-bold tracking-tight">ผู้ดูแลระบบ</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">สิทธิ์ระดับระบบแยกจาก owner และผู้ร่วมจัดการโครงการ ใช้สำหรับดูแลบัญชีและช่วยแก้ปัญหาเท่านั้น</p>
      </div>
      <Badge variant="outline" className="w-fit">ADMIN · {actor.name}</Badge>
    </header>

    <aside className="rounded-lg border border-amber-300/60 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">Admin จัดการบัญชีผู้ใช้และโครงการทั้งหมดได้ ทุกการเปลี่ยนแปลงสำคัญจะถูกบันทึกใน audit log</aside>

    <nav aria-label="ส่วนผู้ดูแลระบบ" className="flex flex-wrap gap-1 border-b">
      {tabs.map((tab) => <Link key={tab.value} href={`/admin?view=${tab.value}`} aria-current={view === tab.value ? "page" : undefined}
        className={`border-b-2 px-3 py-3 text-sm ${view === tab.value ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
        {tab.label} <span className="ml-1 text-xs text-muted-foreground">{tab.count.toLocaleString("th-TH")}</span>
      </Link>)}
    </nav>

    {view !== "audit" && <form method="get" className="flex max-w-xl items-center gap-2">
      <input type="hidden" name="view" value={view} />
      <label htmlFor="admin-search" className="sr-only">ค้นหา{view === "users" ? "ผู้ใช้" : "โครงการ"}</label>
      <Input id="admin-search" name="q" defaultValue={query} maxLength={100} placeholder={view === "users" ? "ค้นหาชื่อหรืออีเมล" : "ค้นหาชื่อหรือ slug โครงการ"} />
      <Button type="submit" variant="outline">ค้นหา</Button>
    </form>}

    {view === "users" && <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <div><h2 className="font-heading text-lg font-semibold">สร้างบัญชีผู้ใช้</h2><p className="text-sm text-muted-foreground">เว้นช่องรหัสผ่านว่างเพื่อสร้างลิงก์เชิญ (อายุ 7 วัน) ให้ผู้ใช้ตั้งรหัสผ่านเอง หรือกำหนดรหัสผ่านเริ่มต้นอย่างน้อย 12 ตัว</p></div>
      {params.created === "1" && <p role="status" className="text-sm text-primary">สร้างบัญชีเรียบร้อยแล้ว</p>}
      {params.error === "email-exists" && <p role="alert" className="text-sm text-destructive">อีเมลนี้มีบัญชีในระบบแล้ว</p>}
      {params.error === "invalid-user" && <p role="alert" className="text-sm text-destructive">กรุณาตรวจชื่อ อีเมล บทบาท และรหัสผ่าน (อย่างน้อย 12 ตัว)</p>}
      {params.error === "inactive-link" && <p role="alert" className="text-sm text-destructive">ออกลิงก์ตั้งรหัสผ่านให้บัญชีที่ปิดใช้งานไม่ได้</p>}
      {params.updated === "1" && <p role="status" className="text-sm text-primary">บันทึกข้อมูลบัญชีแล้ว</p>}
      {params.error === "invalid-user-edit" && <p role="alert" className="text-sm text-destructive">กรุณาตรวจข้อมูลบัญชีและรหัสผ่านใหม่ (อย่างน้อย 12 ตัว)</p>}
      <form action={createUser} className="flex flex-col gap-4">
        <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field><FieldLabel htmlFor="new-user-name">ชื่อ</FieldLabel><Input id="new-user-name" name="name" required maxLength={191} /></Field>
          <Field><FieldLabel htmlFor="new-user-email">อีเมล</FieldLabel><Input id="new-user-email" name="email" type="email" required maxLength={191} /></Field>
          <Field><FieldLabel htmlFor="new-user-password">รหัสผ่านเริ่มต้น (ไม่บังคับ)</FieldLabel><Input id="new-user-password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" placeholder="เว้นว่าง = สร้างลิงก์เชิญ" /></Field>
          <Field><FieldLabel htmlFor="new-user-role">บทบาท</FieldLabel><select id="new-user-role" name="role" defaultValue="ORGANIZER" className="h-9 rounded-md border bg-background px-3 text-sm"><option value="ORGANIZER">ผู้จัดโครงการ</option><option value="STAFF">เจ้าหน้าที่</option><option value="ADMIN">ผู้ดูแลระบบ</option></select></Field>
        </FieldGroup>
        <div><Button type="submit" size="sm">สร้างบัญชี</Button></div>
      </form>
    </section>}
    {view === "users" && <section className="overflow-x-auto rounded-xl border bg-card" aria-label="ผู้ใช้ในระบบ">
      <Table>
        <TableHeader className="bg-secondary"><TableRow>
          <TableHead className="min-w-64 px-5">ผู้ใช้</TableHead><TableHead>บทบาท</TableHead><TableHead>โครงการที่เกี่ยวข้อง</TableHead><TableHead>สถานะ</TableHead><TableHead className="min-w-56">จัดการ</TableHead>
        </TableRow></TableHeader>
        <TableBody>{users.map((user) => <TableRow key={user.id}>
          <TableCell className="px-5"><div className="font-medium">{user.name}</div><div className="text-xs text-muted-foreground">{user.email}</div></TableCell>
          <TableCell><Badge variant={user.role === "ADMIN" ? "default" : "outline"}>{roleLabel[user.role]}</Badge></TableCell>
          <TableCell>{(user._count.ownedEvents + user._count.organizerOf).toLocaleString("th-TH")}</TableCell>
          <TableCell><div className="flex flex-wrap gap-1"><Badge variant={user.isActive ? "secondary" : "destructive"}>{user.isActive ? "ใช้งาน" : "ปิดใช้งาน"}</Badge>{!user.passwordHash && <Badge variant="outline">รอตั้งรหัสผ่าน</Badge>}</div></TableCell>
          <TableCell><div className="flex flex-wrap items-center gap-2">
            <form action={updateUserRole} className="flex items-center gap-1">
              <input type="hidden" name="userId" value={user.id} />
              <label htmlFor={`role-${user.id}`} className="sr-only">เปลี่ยนบทบาทของ {user.name}</label>
              <select id={`role-${user.id}`} name="role" defaultValue={user.role} disabled={user.id === actor.id} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="ORGANIZER">ผู้จัดโครงการ</option><option value="STAFF">เจ้าหน้าที่</option><option value="ADMIN">ผู้ดูแลระบบ</option>
              </select>
              <Button type="submit" size="sm" variant="outline" disabled={user.id === actor.id}>บันทึก</Button>
            </form>
            <form action={toggleUserActive}>
              <input type="hidden" name="userId" value={user.id} /><input type="hidden" name="active" value={String(!user.isActive)} />
              <Button type="submit" size="sm" variant={user.isActive ? "destructive" : "outline"} disabled={user.id === actor.id}>{user.isActive ? "ปิดบัญชี" : "เปิดบัญชี"}</Button>
            </form>
            <form action={issuePasswordLink}>
              <input type="hidden" name="userId" value={user.id} />
              <Button type="submit" size="sm" variant="outline" disabled={!user.isActive}>{user.passwordHash ? "ออกลิงก์รีเซ็ตรหัสผ่าน" : "ออกลิงก์เชิญใหม่"}</Button>
            </form>
            <details className="basis-full rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">แก้ชื่อ อีเมล หรือรหัสผ่าน</summary>
              <form action={updateUserDetails} className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="userId" value={user.id} />
                <FieldGroup className="grid gap-3 sm:grid-cols-2">
                  <Field><FieldLabel htmlFor={`name-${user.id}`}>ชื่อ</FieldLabel><Input id={`name-${user.id}`} name="name" defaultValue={user.name} required maxLength={191} /></Field>
                  <Field><FieldLabel htmlFor={`email-${user.id}`}>อีเมล</FieldLabel><Input id={`email-${user.id}`} name="email" type="email" defaultValue={user.email} required maxLength={191} /></Field>
                  <Field><FieldLabel htmlFor={`password-${user.id}`}>ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)</FieldLabel><Input id={`password-${user.id}`} name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" /></Field>
                </FieldGroup>
                <Button type="submit" size="sm" variant="outline">บันทึกข้อมูลบัญชี</Button>
              </form>
            </details>
          </div></TableCell>
        </TableRow>)}</TableBody>
      </Table>
      {users.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">ไม่พบผู้ใช้ที่ตรงกับคำค้น</p>}
    </section>}

    {view === "events" && <section className="overflow-x-auto rounded-xl border bg-card" aria-label="โครงการทั้งหมด">
      <Table><TableHeader className="bg-secondary"><TableRow><TableHead className="min-w-72 px-5">โครงการ</TableHead><TableHead>เจ้าของ</TableHead><TableHead>ผู้ลงทะเบียน</TableHead><TableHead>ผู้ร่วมจัด</TableHead><TableHead>สถานะ</TableHead><TableHead>อัปเดตล่าสุด</TableHead></TableRow></TableHeader>
        <TableBody>{events.map((event) => <TableRow key={event.id}>
          <TableCell className="px-5"><Link className="font-medium hover:underline" href={`/admin/events/${event.id}`} prefetch={false}>{event.title}</Link><div className="text-xs text-muted-foreground">{event.slug}</div></TableCell>
          <TableCell>{event.owner.name}<div className="text-xs text-muted-foreground">{event.owner.email}</div></TableCell>
          <TableCell>{event._count.registrants}</TableCell><TableCell>{event._count.organizers}</TableCell>
          <TableCell><Badge variant={event.deletedAt ? "destructive" : event.status === "PUBLISHED" ? "default" : "outline"}>{event.deletedAt ? "เก็บย้อนหลัง" : event.status}</Badge></TableCell>
          <TableCell>{dateFormatter.format(event.updatedAt)}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
      {events.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">ไม่พบโครงการที่ตรงกับคำค้น</p>}
    </section>}

    {view === "audit" && <form method="get" className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-label="กรอง audit log">
      <input type="hidden" name="view" value="audit" />
      <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field><FieldLabel htmlFor="audit-actor">ผู้ดำเนินการ</FieldLabel><Input id="audit-actor" name="actor" defaultValue={auditActor} maxLength={100} placeholder="ชื่อหรืออีเมล" /></Field>
        <Field><FieldLabel htmlFor="audit-scope">ขอบเขต</FieldLabel><select id="audit-scope" name="scope" defaultValue={auditScope} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="all">ทั้งหมด</option><option value="system">ระดับระบบ</option><option value="event">เฉพาะโครงการ</option></select></Field>
        <Field><FieldLabel htmlFor="audit-event">โครงการ</FieldLabel><Input id="audit-event" name="event" defaultValue={auditEvent} maxLength={100} placeholder="ชื่อ slug หรือ id" /></Field>
        <Field><FieldLabel htmlFor="audit-from">ตั้งแต่วันที่</FieldLabel><Input id="audit-from" name="from" type="date" defaultValue={typeof params.from === "string" ? params.from : ""} /></Field>
        <Field><FieldLabel htmlFor="audit-to">ถึงวันที่</FieldLabel><Input id="audit-to" name="to" type="date" defaultValue={typeof params.to === "string" ? params.to : ""} /></Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-2"><Button type="submit" size="sm" variant="outline">กรอง</Button><Link href="/admin?view=audit" className="text-sm text-muted-foreground underline-offset-4 hover:underline">ล้างตัวกรอง</Link><span className="text-xs text-muted-foreground">พบ {counts[2].toLocaleString("th-TH")} รายการ{counts[2] > AUDIT_PAGE_SIZE ? ` · แสดงล่าสุด ${AUDIT_PAGE_SIZE} รายการ` : ""} · เวลาเป็น Asia/Bangkok</span></div>
    </form>}
    {view === "audit" && <section className="overflow-x-auto rounded-xl border bg-card" aria-label="Audit log">
      <Table><TableHeader className="bg-secondary"><TableRow><TableHead className="min-w-40 px-5">เวลา</TableHead><TableHead>ผู้ดำเนินการ</TableHead><TableHead>โครงการ</TableHead><TableHead>การเปลี่ยนแปลง</TableHead><TableHead>เป้าหมาย</TableHead><TableHead>รายละเอียด</TableHead></TableRow></TableHeader>
        <TableBody>{logs.map((log) => <TableRow key={log.id}>
          <TableCell className="px-5">{dateFormatter.format(log.createdAt)}</TableCell><TableCell>{log.actor?.name ?? "ผู้ลงทะเบียน"}<div className="text-xs text-muted-foreground">{log.actor?.email ?? "ผ่านลิงก์สถานะส่วนตัว"}</div></TableCell>
          <TableCell className="max-w-56 whitespace-normal">{log.event ? <Link href={`/admin/events/${log.event.id}`} prefetch={false} className="hover:underline">{log.event.title}</Link> : <span className="text-muted-foreground">ระบบ</span>}</TableCell>
          <TableCell><code className="text-xs">{log.action}</code></TableCell><TableCell><code className="text-xs">{log.target ?? "—"}</code></TableCell>
          <TableCell className="max-w-80 whitespace-normal text-xs">{log.metadata ? JSON.stringify(log.metadata) : "—"}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
      {logs.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">ไม่พบ audit log ตามตัวกรอง</p>}
    </section>}
  </main>;
}
