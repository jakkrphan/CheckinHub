import type { Metadata } from "next";
import Link from "next/link";
import { HistoryIcon, LayoutGridIcon, ShieldCheckIcon, SlidersHorizontalIcon, MoreHorizontalIcon, SearchIcon, ShieldIcon, UserPlusIcon, UsersIcon, XIcon } from "lucide-react";

import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auditToneClass, describeAudit } from "@/features/audit/labels";
import { cn } from "@/lib/utils";
import type { Prisma, UserRole } from "@prisma/client";
import { ldapEnabled } from "@/server/auth/ldap";
import { requireAdminUser } from "@/server/authorization/session";
import { db } from "@/server/db";

import { createUser, issuePasswordLink, toggleUserActive, updateUserDetails, updateUserRole } from "./actions";
import { FeatureSettings } from "./feature-settings";

export const metadata: Metadata = { title: "ผู้ดูแลระบบ" };

const statusLabel = { DRAFT: "ฉบับร่าง", PUBLISHED: "เผยแพร่แล้ว", CLOSED: "ปิดรับ" } as const;
const dateFormatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const relativeFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
const AUDIT_PAGE_SIZE = 200;
// Below md, rows of read-only tables become cards; cells with data-label show that label in front of the value.
const stackedTable = "max-md:block [&_thead]:max-md:hidden [&_tbody]:max-md:block";
const stackedRow = "max-md:flex max-md:flex-col max-md:gap-1.5 max-md:px-4 max-md:py-3.5 [&>td]:max-md:max-w-none [&>td]:max-md:p-0 [&>td]:max-md:whitespace-normal [&>td[data-label]]:max-md:flex [&>td[data-label]]:max-md:items-baseline [&>td[data-label]]:max-md:gap-3 [&>td[data-label]]:max-md:before:w-24 [&>td[data-label]]:max-md:before:shrink-0 [&>td[data-label]]:max-md:before:text-xs [&>td[data-label]]:max-md:before:text-muted-foreground [&>td[data-label]]:max-md:before:content-[attr(data-label)]";
// The events table has six columns and needs ~1100px, so it stays stacked up to xl.
const stackedTableXl = "max-xl:block [&_thead]:max-xl:hidden [&_tbody]:max-xl:block";
const stackedRowXl = "max-xl:flex max-xl:flex-col max-xl:gap-1.5 max-xl:px-4 max-xl:py-3.5 [&>td]:max-xl:max-w-none [&>td]:max-xl:p-0 [&>td]:max-xl:whitespace-normal [&>td[data-label]]:max-xl:flex [&>td[data-label]]:max-xl:items-baseline [&>td[data-label]]:max-xl:gap-3 [&>td[data-label]]:max-xl:before:w-24 [&>td[data-label]]:max-xl:before:shrink-0 [&>td[data-label]]:max-xl:before:text-xs [&>td[data-label]]:max-xl:before:text-muted-foreground [&>td[data-label]]:max-xl:before:content-[attr(data-label)]";
const selectClass = "h-10 rounded-md border bg-background px-2.5 text-base outline-none md:h-9 md:text-sm focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** Parses a yyyy-mm-dd filter as a Bangkok calendar day boundary. */
function bangkokDay(value: unknown, endOfDay: boolean) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+07:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Whole days between `date` and this request (server-rendered, so "now" is the request time). */
function daysSince(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

const initials = (name: string) => name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2) || "?";

function Flash({ params }: { params: Record<string, string | string[] | undefined> }) {
  const notices: [string, "ok" | "error"][] = [];
  if (params.created === "1") notices.push(["สร้างบัญชีเรียบร้อยแล้ว", "ok"]);
  if (params.updated === "1") notices.push(["บันทึกข้อมูลบัญชีแล้ว", "ok"]);
  if (params.deleted === "1") notices.push(["ลบโครงการแล้ว", "ok"]);
  if (params.deleted === "archived") notices.push(["ปิดโครงการและเก็บข้อมูลไว้ตรวจสอบย้อนหลังแล้ว", "ok"]);
  if (params.error === "email-exists") notices.push(["อีเมลนี้มีบัญชีในระบบแล้ว", "error"]);
  if (params.error === "invalid-user") notices.push(["สร้างบัญชีไม่ได้: ตรวจชื่อ อีเมล บทบาท และรหัสผ่าน (อย่างน้อย 12 ตัว หรือเว้นว่างเพื่อส่งลิงก์เชิญ)", "error"]);
  if (params.error === "invalid-user-edit") notices.push(["แก้บัญชีไม่ได้: ตรวจข้อมูลและรหัสผ่านใหม่ (อย่างน้อย 12 ตัว)", "error"]);
  if (params.error === "invalid-setting") notices.push(["บันทึกการตั้งค่าไม่ได้: ฟังก์ชันนี้ยังเปลี่ยนไม่ได้หรือข้อมูลไม่ถูกต้อง", "error"]);
  if (params.error === "ldap-link") notices.push(["บัญชีนี้เข้าสู่ระบบด้วยรหัสผ่าน AD จึงไม่มีลิงก์ตั้งรหัสผ่าน ถ้าจำเป็นต้องมีรหัสในระบบ (เช่น บัญชีสำรองตอน AD ล่ม) ให้ตั้งในช่องรหัสผ่านใหม่", "error"]);
  if (params.error === "inactive-link") notices.push(["ออกลิงก์ตั้งรหัสผ่านให้บัญชีที่ปิดใช้งานไม่ได้ เปิดบัญชีก่อน", "error"]);
  if (!notices.length) return null;
  return <div className="flex flex-col gap-2">{notices.map(([text, tone]) => <p key={text} role={tone === "error" ? "alert" : "status"}
    className={cn("rounded-lg border px-4 py-3 text-sm", tone === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/30 bg-accent text-accent-foreground")}>{text}</p>)}</div>;
}

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const actor = await requireAdminUser();
  const params = await searchParams;
  const view = params.view === "events" || params.view === "audit" || params.view === "settings" || params.view === "requests" ? params.view : "users";
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const roleFilter: UserRole | undefined = params.role === "ADMIN" || params.role === "ORGANIZER" ? params.role : undefined;
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
  const userWhere: Prisma.UserWhereInput = { ...(query ? { OR: [{ name: { contains: query } }, { email: { contains: query } }] } : {}), ...(roleFilter ? { role: roleFilter } : {}) };
  const [dataRequests, openRequestCount] = await Promise.all([
    view === "requests" ? db.dataRequest.findMany({
      where: params.requests === "all" ? {} : { status: "OPEN" }, orderBy: [{ status: "asc" }, { requestedAt: "asc" }], take: 200,
      select: { id: true, status: true, requestedAt: true, resolvedAt: true, resolutionNote: true, registrantId: true, registrant: { select: { displayName: true, email: true } }, event: { select: { id: true, title: true } }, resolvedBy: { select: { name: true } } },
    }) : Promise.resolve([]),
    db.dataRequest.count({ where: { status: "OPEN" } }),
  ]);
  const ldap = ldapEnabled();
  const [users, events, logs, recentLogs, counts] = await Promise.all([
    view === "users" ? db.user.findMany({
      where: userWhere,
      orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
      select: { id: true, name: true, email: true, role: true, isActive: true, passwordHash: true, ldapId: true, _count: { select: { ownedEvents: true, organizerOf: true } } },
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
    view === "users" ? db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { actor: { select: { name: true } }, event: { select: { title: true } } } }) : Promise.resolve([]),
    Promise.all([db.user.count(), db.event.count(), view === "audit" ? db.auditLog.count({ where: auditWhere }) : db.auditLog.count(), view === "users" ? db.user.count({ where: userWhere }) : Promise.resolve(0)]),
  ]);

  const tabs = [
    { value: "users", label: "ผู้ใช้ในระบบ", count: counts[0], icon: UsersIcon },
    { value: "events", label: "โครงการทั้งหมด", count: counts[1], icon: LayoutGridIcon },
    { value: "audit", label: "Audit log", count: counts[2], icon: HistoryIcon },
    { value: "requests", label: "คำขอ PDPA", count: openRequestCount, icon: ShieldCheckIcon },
    { value: "settings", label: "ตั้งค่าระบบ", count: null, icon: SlidersHorizontalIcon },
  ];

  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 lg:px-10">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-3xl font-bold tracking-tight">ผู้ดูแลระบบ</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">สิทธิ์ระดับระบบ แยกจาก owner/ผู้ร่วมจัดของแต่ละโครงการ · มีไว้ดูแลระบบและแก้ปัญหาเท่านั้น</p>
      </div>
      <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 lg:max-w-md"><ShieldIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />ทุกครั้งที่ admin เปิด/แก้โครงการที่ไม่ได้เป็นเจ้าของ หรือเปลี่ยนบัญชีผู้ใช้ ระบบบันทึก audit log อัตโนมัติ</p>
    </header>

    <nav aria-label="ส่วนผู้ดูแลระบบ" className="grid grid-cols-2 gap-1 border-b sm:flex">
      {tabs.map(({ value, label, count, icon: Icon }) => <Link key={value} href={`/admin?view=${value}`} aria-current={view === value ? "page" : undefined}
        className={cn("flex min-h-11 shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-b-2 px-2 py-2.5 text-center text-sm sm:flex-nowrap sm:px-3", view === value ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
        <Icon className="size-4 max-sm:hidden" aria-hidden="true" />{label}{count !== null && <span className="text-xs text-muted-foreground">{count.toLocaleString("th-TH")}</span>}
      </Link>)}
    </nav>

    <Flash params={params} />

    {view === "users" && <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex flex-col overflow-hidden rounded-xl border bg-card" aria-label="ผู้ใช้ในระบบ">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <form method="get" className="flex flex-1 flex-wrap items-center gap-2" role="search">
            <input type="hidden" name="view" value="users" />
            <div className="relative min-w-48 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="admin-search" className="sr-only">ค้นหาผู้ใช้</label>
              <Input id="admin-search" name="q" defaultValue={query} maxLength={100} placeholder="ค้นหาชื่อ / อีเมล" className="pl-9" />
            </div>
            <label htmlFor="admin-role-filter" className="sr-only">กรองตามสิทธิ์</label>
            <select id="admin-role-filter" name="role" defaultValue={roleFilter ?? ""} className={selectClass}><option value="">ทุกสิทธิ์</option><option value="ADMIN">ผู้ดูแลระบบ</option><option value="ORGANIZER">ผู้จัดโครงการ</option></select>
            <Button type="submit" variant="outline">ค้นหา</Button>
          </form>
          <Button type="button" popoverTarget="create-user-panel"><UserPlusIcon data-icon="inline-start" aria-hidden="true" />สร้างบัญชี</Button>
          <div id="create-user-panel" popover="auto" className="m-auto w-[min(92vw,400px)] rounded-xl border bg-card p-5 shadow-xl backdrop:bg-black/30">
            <form action={createUser} className="flex flex-col gap-4">
              <p className="font-heading font-bold">สร้างบัญชีผู้ใช้</p>
              <FieldGroup>
                <Field><FieldLabel htmlFor="new-user-name">ชื่อ</FieldLabel><Input id="new-user-name" name="name" required maxLength={191} /></Field>
                <Field><FieldLabel htmlFor="new-user-email">อีเมล</FieldLabel><Input id="new-user-email" name="email" type="email" required maxLength={191} /></Field>
                <Field><FieldLabel htmlFor="new-user-role">สิทธิ์ระดับระบบ</FieldLabel><select id="new-user-role" name="role" defaultValue="ORGANIZER" className={selectClass}><option value="ORGANIZER">ผู้จัดโครงการ</option><option value="ADMIN">ผู้ดูแลระบบ</option></select></Field>
                <Field><FieldLabel htmlFor="new-user-password">รหัสผ่านเริ่มต้น (ไม่บังคับ)</FieldLabel><Input id="new-user-password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" placeholder={ldap ? "เว้นว่าง = เข้าด้วยบัญชี AD" : "เว้นว่าง = สร้างลิงก์เชิญ"} /><FieldDescription>{ldap ? "เว้นว่างเพื่อให้เข้าสู่ระบบด้วยบัญชี AD — ช่องอีเมลใส่ UPN ของ AD (เช่น somchai@rpphosp.local) ระบบจะผูกบัญชีเมื่อเข้าครั้งแรก" : "เว้นว่างเพื่อให้ผู้ใช้ตั้งรหัสผ่านเองจากลิงก์เชิญ (อายุ 7 วัน)"}</FieldDescription></Field>
              </FieldGroup>
              <Button type="submit">สร้างบัญชี</Button>
            </form>
          </div>
        </div>
        <div className="overflow-x-auto">
          {/* Below md each user row becomes a card: user | actions, then role | status. */}
          <Table className="max-md:block">
            <TableHeader className="bg-secondary max-md:hidden"><TableRow>
              <TableHead className="min-w-56 px-5">ผู้ใช้</TableHead><TableHead>สิทธิ์ระดับระบบ</TableHead><TableHead>สถานะบัญชี</TableHead><TableHead className="w-0"><span className="sr-only">จัดการ</span></TableHead>
            </TableRow></TableHeader>
            <TableBody className="max-md:block">{users.map((user) => {
              const self = user.id === actor.id;
              return <TableRow key={user.id} className={cn("max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:items-center max-md:gap-x-3 max-md:gap-y-2.5 max-md:px-4 max-md:py-3.5 [&>td]:max-md:p-0 [&>td]:max-md:whitespace-normal", !user.isActive && "bg-muted/40")}>
                <TableCell className="px-5 max-md:col-start-1 max-md:row-start-1"><div className="flex items-center gap-3">
                  <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">{initials(user.name)}</span>
                  <span className="flex min-w-0 max-w-[16rem] flex-col"><span className="truncate font-semibold">{user.name}{self && <span className="ml-1 text-xs font-normal text-muted-foreground">(คุณ)</span>}</span><span className="truncate text-xs text-muted-foreground">{user.email}</span><span className="text-xs text-muted-foreground">{user._count.ownedEvents || user._count.organizerOf ? [user._count.ownedEvents ? `เจ้าของ ${user._count.ownedEvents} โครงการ` : "", user._count.organizerOf ? `ร่วมจัด ${user._count.organizerOf}` : ""].filter(Boolean).join(" · ") : "ยังไม่มีโครงการ"}</span></span>
                </div></TableCell>
                <TableCell className="max-md:col-start-1 max-md:row-start-2">
                  <form action={updateUserRole} className="flex items-center gap-1">
                    <input type="hidden" name="userId" value={user.id} />
                    <label htmlFor={`role-${user.id}`} className="sr-only">สิทธิ์ของ {user.name}</label>
                    <AutoSubmitSelect key={user.role} id={`role-${user.id}`} name="role" defaultValue={user.role} disabled={self} title={self ? "เปลี่ยนสิทธิ์ของตัวเองไม่ได้" : undefined} className={cn(selectClass, "min-w-32")}>
                      <option value="ORGANIZER">ผู้จัดโครงการ</option><option value="ADMIN">ผู้ดูแลระบบ</option>
                    </AutoSubmitSelect>
                    <noscript><Button type="submit" size="sm" variant="outline">บันทึก</Button></noscript>
                  </form>
                </TableCell>
                <TableCell className="max-md:col-start-2 max-md:row-start-2 max-md:justify-self-end"><div className="flex flex-wrap gap-1">
                  <Badge variant="secondary" className={user.isActive ? "bg-emerald-100 text-emerald-900" : ""}>{user.isActive ? "ใช้งานอยู่" : "ปิดการใช้งาน"}</Badge>
                  {user.ldapId ? <Badge variant="outline">AD</Badge>
                    : ldap && !user.passwordHash ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">รอเข้าด้วย AD ครั้งแรก</Badge>
                    : !user.passwordHash && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">รอตั้งรหัสผ่าน</Badge>}
                </div></TableCell>
                <TableCell className="pr-4 max-md:col-start-2 max-md:row-start-1"><div className="flex items-center justify-end gap-1.5">
                  <form action={toggleUserActive}>
                    <input type="hidden" name="userId" value={user.id} /><input type="hidden" name="active" value={String(!user.isActive)} />
                    <Button type="submit" size="sm" variant="outline" disabled={self} title={self ? "ปิดบัญชีของตัวเองไม่ได้" : undefined} className={cn(user.isActive && "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive")}>{user.isActive ? "ปิดบัญชี" : "เปิดใช้งาน"}</Button>
                  </form>
                  <Button type="button" variant="ghost" size="icon" popoverTarget={`user-menu-${user.id}`} aria-label={`จัดการเพิ่มเติมสำหรับ ${user.name}`}><MoreHorizontalIcon aria-hidden="true" /></Button>
                  {/* Native popover renders in the top layer, so the table's scroll container cannot clip it. */}
                  <div id={`user-menu-${user.id}`} popover="auto" className="m-auto w-[min(92vw,380px)] rounded-xl border bg-card p-5 text-left shadow-xl backdrop:bg-black/30">
                    <div className="flex flex-col gap-4">
                      <div className="flex items-start justify-between gap-2"><div><p className="font-heading font-bold">{user.name}</p><p className="text-xs text-muted-foreground">{user.email}</p></div><Button type="button" variant="ghost" size="icon-sm" popoverTarget={`user-menu-${user.id}`} popoverTargetAction="hide" aria-label="ปิด"><XIcon aria-hidden="true" /></Button></div>
                      {(user.passwordHash || !(ldap || user.ldapId)) && <form action={issuePasswordLink} className="flex flex-col gap-1.5">
                        <input type="hidden" name="userId" value={user.id} />
                        <Button type="submit" size="sm" variant="outline" disabled={!user.isActive}>{user.passwordHash ? "ออกลิงก์รีเซ็ตรหัสผ่าน" : "ออกลิงก์เชิญใหม่"}</Button>
                        <span className="text-xs text-muted-foreground">{!user.isActive ? "เปิดบัญชีก่อนจึงออกลิงก์ได้" : user.passwordHash ? "ลิงก์ใช้ได้ครั้งเดียว อายุ 30 นาที" : "ลิงก์ใช้ได้ครั้งเดียว อายุ 7 วัน"}</span>
                      </form>}
                      <form action={updateUserDetails} className="flex flex-col gap-3 border-t pt-4">
                        <input type="hidden" name="userId" value={user.id} />
                        <p className="text-sm font-semibold">แก้ชื่อ อีเมล หรือรหัสผ่าน</p>
                        <Field><FieldLabel htmlFor={`name-${user.id}`}>ชื่อ</FieldLabel><Input id={`name-${user.id}`} name="name" defaultValue={user.name} required maxLength={191} /></Field>
                        <Field><FieldLabel htmlFor={`email-${user.id}`}>อีเมล</FieldLabel><Input id={`email-${user.id}`} name="email" type="email" defaultValue={user.email} required maxLength={191} /></Field>
                        <Field><FieldLabel htmlFor={`password-${user.id}`}>รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)</FieldLabel><Input id={`password-${user.id}`} name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" /></Field>
                        <Button type="submit" size="sm">บันทึกข้อมูลบัญชี</Button>
                      </form>
                    </div>
                  </div>
                </div></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </div>
        {users.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">ไม่พบผู้ใช้ที่ตรงกับคำค้น</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-xs text-muted-foreground"><span>แสดง {users.length.toLocaleString("th-TH")} จาก {counts[0].toLocaleString("th-TH")} บัญชี</span><span>เปลี่ยนสิทธิ์ / ปิดบัญชี = บันทึก audit log ทุกครั้ง</span></div>
      </section>

      <aside className="flex flex-col gap-4 rounded-xl border bg-card p-5" aria-label="Audit log ล่าสุด">
        <div className="flex items-center justify-between"><h2 className="font-heading text-lg font-bold">Audit log ล่าสุด</h2><Link href="/admin?view=audit" className="-my-2.5 py-2.5 text-sm font-semibold text-primary underline-offset-4 hover:underline">ดูทั้งหมด</Link></div>
        {recentLogs.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีบันทึก</p>}
        <ol className="flex flex-col">{recentLogs.map((log) => {
          const { label, tone } = describeAudit(log.action);
          return <li key={log.id} className="flex flex-col gap-1.5 border-t py-3 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-2"><span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", auditToneClass[tone])}>{label}</span><time className="shrink-0 text-xs text-muted-foreground" dateTime={log.createdAt.toISOString()}>{relativeFormatter.format(log.createdAt)}</time></div>
            <p className="text-sm"><span className="font-semibold">{log.actor?.name ?? "ผู้ลงทะเบียน/ระบบ"}</span>{log.event ? <span className="text-muted-foreground"> → {log.event.title}</span> : null}</p>
          </li>;
        })}</ol>
        <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">เก็บ: เวลา · ผู้กระทำ · การกระทำ · โครงการ/บัญชีเป้าหมาย — ผู้จัดทั่วไปไม่เห็นหน้านี้</p>
      </aside>
    </div>}

    {view === "events" && <>
      <form method="get" role="search" className="flex max-w-xl items-center gap-2">
        <input type="hidden" name="view" value="events" />
        <label htmlFor="admin-event-search" className="sr-only">ค้นหาโครงการ</label>
        <Input id="admin-event-search" name="q" defaultValue={query} maxLength={100} placeholder="ค้นหาชื่อหรือ slug โครงการ" />
        <Button type="submit" variant="outline">ค้นหา</Button>
      </form>
      <section className="overflow-x-auto rounded-xl border bg-card" aria-label="โครงการทั้งหมด">
        <Table className={stackedTableXl}><TableHeader className="bg-secondary"><TableRow><TableHead className="min-w-72 px-5">โครงการ</TableHead><TableHead>เจ้าของ</TableHead><TableHead>ผู้ลงทะเบียน</TableHead><TableHead>ผู้ร่วมจัด</TableHead><TableHead>สถานะ</TableHead><TableHead>อัปเดตล่าสุด</TableHead></TableRow></TableHeader>
          <TableBody>{events.map((event) => <TableRow key={event.id} className={stackedRowXl}>
            <TableCell className="max-w-md px-5 whitespace-normal [overflow-wrap:anywhere]"><Link className="inline-block py-1 font-semibold hover:underline" href={`/admin/events/${event.id}`} prefetch={false}>{event.title}</Link><div className="text-xs text-muted-foreground">{event.slug}</div></TableCell>
            <TableCell data-label="เจ้าของ"><span>{event.owner.name}<span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{event.owner.email}</span></span></TableCell>
            <TableCell data-label="ผู้ลงทะเบียน">{event._count.registrants.toLocaleString("th-TH")}</TableCell><TableCell data-label="ผู้ร่วมจัด">{event._count.organizers.toLocaleString("th-TH")}</TableCell>
            <TableCell data-label="สถานะ"><Badge variant="secondary" className={event.deletedAt ? "bg-rose-100 text-rose-900" : event.status === "PUBLISHED" ? "bg-emerald-100 text-emerald-900" : event.status === "DRAFT" ? "bg-amber-100 text-amber-900" : ""}>{event.deletedAt ? "ลบแล้ว (เก็บย้อนหลัง)" : statusLabel[event.status]}</Badge></TableCell>
            <TableCell data-label="อัปเดตล่าสุด" className="text-sm text-muted-foreground">{dateFormatter.format(event.updatedAt)}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
        {events.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">ไม่พบโครงการที่ตรงกับคำค้น</p>}
      </section>
    </>}

    {view === "audit" && <form method="get" className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-label="กรอง audit log">
      <input type="hidden" name="view" value="audit" />
      <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field><FieldLabel htmlFor="audit-actor">ผู้ดำเนินการ</FieldLabel><Input id="audit-actor" name="actor" defaultValue={auditActor} maxLength={100} placeholder="ชื่อหรืออีเมล" /></Field>
        <Field><FieldLabel htmlFor="audit-scope">ขอบเขต</FieldLabel><select id="audit-scope" name="scope" defaultValue={auditScope} className={selectClass}><option value="all">ทั้งหมด</option><option value="system">ระดับระบบ</option><option value="event">เฉพาะโครงการ</option></select></Field>
        <Field><FieldLabel htmlFor="audit-event">โครงการ</FieldLabel><Input id="audit-event" name="event" defaultValue={auditEvent} maxLength={100} placeholder="ชื่อ slug หรือ id" /></Field>
        <Field><FieldLabel htmlFor="audit-from">ตั้งแต่วันที่</FieldLabel><Input id="audit-from" name="from" type="date" defaultValue={typeof params.from === "string" ? params.from : ""} /></Field>
        <Field><FieldLabel htmlFor="audit-to">ถึงวันที่</FieldLabel><Input id="audit-to" name="to" type="date" defaultValue={typeof params.to === "string" ? params.to : ""} /></Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-2"><Button type="submit" size="sm" variant="outline">กรอง</Button><Link href="/admin?view=audit" className="inline-block py-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline">ล้างตัวกรอง</Link><span className="text-xs text-muted-foreground">พบ {counts[2].toLocaleString("th-TH")} รายการ{counts[2] > AUDIT_PAGE_SIZE ? ` · แสดงล่าสุด ${AUDIT_PAGE_SIZE} รายการ` : ""} · เวลาเป็น Asia/Bangkok</span></div>
    </form>}
    {view === "requests" && <section aria-labelledby="requests-title" className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 id="requests-title" className="font-heading text-lg font-bold">คำขอลบข้อมูลจากผู้ลงทะเบียน</h2><p className="text-sm text-muted-foreground">ผู้จัดของแต่ละโครงการเป็นคนดำเนินการ · หน้านี้ใช้ติดตามคำขอที่ค้างทั้งระบบ</p></div>
        <nav aria-label="กรองคำขอ" className="flex gap-1 text-sm">{[["open", "รอดำเนินการ"], ["all", "ทั้งหมด"]].map(([value, label]) => { const active = (params.requests === "all" ? "all" : "open") === value; return <Link key={value} href={`/admin?view=requests${value === "all" ? "&requests=all" : ""}`} aria-current={active ? "page" : undefined} className={cn("inline-flex min-h-9 items-center rounded-md px-3", active ? "bg-secondary font-semibold" : "text-muted-foreground hover:text-foreground")}>{label}</Link>; })}</nav>
      </div>
      <Table className={stackedTable}><TableHeader className="bg-secondary"><TableRow><TableHead className="min-w-40 px-5">วันที่ขอ</TableHead><TableHead>ผู้ลงทะเบียน</TableHead><TableHead>โครงการ</TableHead><TableHead>สถานะ</TableHead></TableRow></TableHeader>
        <TableBody>{dataRequests.map((request) => {
          const waitingDays = daysSince(request.requestedAt);
          return <TableRow key={request.id} className={stackedRow}>
            <TableCell data-label="วันที่ขอ" className="px-5 text-sm">{dateFormatter.format(request.requestedAt)}{request.status === "OPEN" && waitingDays > 0 && <span className={cn("block text-xs", waitingDays >= 14 ? "font-semibold text-destructive" : "text-muted-foreground")}>{`รอมาแล้ว ${waitingDays} วัน`}</span>}</TableCell>
            <TableCell data-label="ผู้ลงทะเบียน" className="max-w-64 whitespace-normal [overflow-wrap:anywhere]">{request.status === "COMPLETED" ? <span className="text-muted-foreground">ลบข้อมูลแล้ว</span> : <Link href={`/organizer/${request.event.id}/registrants?selected=${request.registrantId}`} prefetch={false} className="inline-block py-1 font-medium hover:underline">{request.registrant.displayName ?? request.registrant.email ?? "ผู้ลงทะเบียน"}</Link>}</TableCell>
            <TableCell data-label="โครงการ" className="max-w-64 whitespace-normal"><Link href={`/admin/events/${request.event.id}`} prefetch={false} className="inline-block py-1 hover:underline">{request.event.title}</Link></TableCell>
            <TableCell data-label="สถานะ"><span className="flex flex-col gap-0.5">
              <Badge variant="secondary" className={request.status === "OPEN" ? "bg-sky-100 text-sky-900" : request.status === "COMPLETED" ? "bg-emerald-100 text-emerald-900" : ""}>{request.status === "OPEN" ? "รอดำเนินการ" : request.status === "COMPLETED" ? "ลบแล้ว" : "ปฏิเสธ"}</Badge>
              {request.resolvedAt && <span className="text-xs text-muted-foreground">{`${request.resolvedBy?.name ?? "—"} · ${dateFormatter.format(request.resolvedAt)}`}</span>}
              {request.resolutionNote && <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{request.resolutionNote}</span>}
            </span></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
      {dataRequests.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">{params.requests === "all" ? "ยังไม่มีคำขอลบข้อมูล" : "ไม่มีคำขอที่รอดำเนินการ"}</p>}
    </section>}

    {view === "settings" && <FeatureSettings saved={typeof params.saved === "string" ? params.saved : undefined} />}

    {view === "audit" && <section className="overflow-x-auto rounded-xl border bg-card" aria-label="Audit log">
      <Table className={stackedTable}><TableHeader className="bg-secondary"><TableRow><TableHead className="min-w-40 px-5">เวลา</TableHead><TableHead>ผู้ดำเนินการ</TableHead><TableHead>การกระทำ</TableHead><TableHead>โครงการ</TableHead><TableHead>รายละเอียด</TableHead></TableRow></TableHeader>
        <TableBody>{logs.map((log) => {
          const { label, tone } = describeAudit(log.action);
          return <TableRow key={log.id} className={stackedRow}>
            <TableCell data-label="เวลา" className="px-5 text-sm">{dateFormatter.format(log.createdAt)}</TableCell>
            <TableCell data-label="ผู้ดำเนินการ"><span className="[overflow-wrap:anywhere]">{log.actor?.name ?? "ผู้ลงทะเบียน/ระบบ"}<span className="block text-xs text-muted-foreground">{log.actor?.email ?? "ไม่ใช่บัญชีเจ้าหน้าที่"}</span></span></TableCell>
            <TableCell data-label="การกระทำ"><span><span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-semibold", auditToneClass[tone])}>{label}</span><span className="mt-1 block font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{log.action}</span></span></TableCell>
            <TableCell data-label="โครงการ" className="max-w-56 whitespace-normal">{log.event ? <Link href={`/admin/events/${log.event.id}`} prefetch={false} className="inline-block py-1 hover:underline">{log.event.title}</Link> : <span className="text-muted-foreground">ระบบ</span>}</TableCell>
            <TableCell data-label="รายละเอียด" className="max-w-80 whitespace-normal [&>details]:min-w-0 [&>details]:flex-1">
              {log.metadata || log.target ? <details><summary className="cursor-pointer py-1 text-xs text-muted-foreground">ดูรายละเอียด</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">{JSON.stringify({ target: log.target, ...(log.metadata && typeof log.metadata === "object" ? log.metadata : {}) }, null, 1)}</pre></details> : "—"}
            </TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
      {logs.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">ไม่พบ audit log ตามตัวกรอง</p>}
    </section>}
  </main>;
}
