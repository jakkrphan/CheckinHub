"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireEventAccess } from "@/server/authorization/event";
import { canManageEvent, requiresAdminAudit } from "@/server/authorization/policy";
import { db } from "@/server/db";

export type ScanResult = {
  kind: "success" | "duplicate" | "invalid" | "wrong-day" | "session-missing" | "error";
  message: string;
  /** Set on wrong-day results when the operator may admit the person as a special case. */
  canOverride?: boolean;
};

const timeFormatter = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

function validClientEventId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) || /^[0-9a-f]{64}$/i.test(value);
}

async function recordCheckIn(eventId: string, sessionId: string, code: string, options: { clientEventId?: string; scannedAt?: string; override?: { note: string } }): Promise<ScanResult> {
  const { user, event, membership } = await requireEventAccess(eventId, "checkIn");
  const mayOverride = canManageEvent(membership);
  if (options.override && !mayOverride) return { kind: "invalid", message: "บัญชีนี้ไม่มีสิทธิ์อนุญาตเป็นกรณีพิเศษ" };
  if (!code || code.length > 200) return { kind: "invalid", message: "รหัสไม่ถูกต้อง" };
  const { clientEventId } = options;
  if (clientEventId && !validClientEventId(clientEventId)) return { kind: "invalid", message: "รหัสรายการออฟไลน์ไม่ถูกต้อง" };
  const scannedDate = options.scannedAt ? new Date(options.scannedAt) : new Date();
  if (Number.isNaN(scannedDate.valueOf()) || scannedDate.getTime() > Date.now() + 5 * 60 * 1000) return { kind: "invalid", message: "เวลาเช็คชื่อไม่ถูกต้อง" };
  const fromQueue = !!options.scannedAt;
  try {
    const result = await db.$transaction(async (tx): Promise<ScanResult> => {
      if (clientEventId && await tx.checkIn.findUnique({ where: { clientEventId }, select: { id: true } })) return { kind: "duplicate", message: "รายการสแกนนี้บันทึกแล้ว" };
      const session = await tx.session.findFirst({ where: { id: sessionId, eventId }, select: { eventDayId: true } });
      if (!session) return { kind: "session-missing", message: "รอบเช็คชื่อนี้ถูกลบแล้ว ไม่ได้บันทึก กรุณาแจ้งผู้จัด" };
      const person = await tx.registrant.findFirst({ where: { eventId, qrCode: code.trim() }, select: { id: true } });
      if (!person) return { kind: "invalid", message: "ไม่พบรหัสที่อนุมัติแล้ว (อาจยังไม่อนุมัติหรือถูกยกเลิกแล้ว)" };
      await tx.$queryRaw`SELECT id FROM Registrant WHERE id = ${person.id} FOR UPDATE`;
      const current = await tx.registrant.findUnique({ where: { id: person.id }, select: { status: true, qrCode: true, days: { select: { eventDayId: true, status: true } } } });
      if (current?.status !== "APPROVED" || current.qrCode !== code.trim()) return { kind: "invalid", message: "ไม่พบรหัสที่อนุมัติแล้ว (อาจยังไม่อนุมัติหรือถูกยกเลิกแล้ว)" };
      const existing = await tx.checkIn.findUnique({ where: { activeKey: `${person.id}:${sessionId}` }, select: { checkedInAt: true } });
      if (existing) return { kind: "duplicate", message: `${fromQueue ? "มีการเช็คชื่อจากเครื่องอื่นแล้ว" : "เช็คชื่อรอบนี้ไปแล้ว"} เมื่อ ${timeFormatter.format(existing.checkedInAt)}` };
      const dayRow = session.eventDayId ? current.days.find((day) => day.eventDayId === session.eventDayId) : undefined;
      const outsideDay = !!session.eventDayId && dayRow?.status !== "APPROVED";
      if (outsideDay && !options.override) {
        const message = !dayRow
          ? event.seatMode === "whole_course" ? "ไม่พบวันนี้ในรายการของผู้เข้าอบรม (ข้อมูลหลักสูตรไม่ครบ กรุณาแจ้งผู้จัดตรวจสอบ)" : "ไม่ได้ลงทะเบียนวันนี้ไว้"
          : dayRow.status === "WAITLISTED" ? "วันนี้ยังอยู่ในคิวรอ" : "ยังไม่ได้รับอนุมัติสำหรับวันที่ของรอบนี้";
        return { kind: "wrong-day", message, canOverride: mayOverride };
      }
      const checkIn = await tx.checkIn.create({ data: {
        registrantId: person.id, sessionId, checkedInById: user.id, checkedInAt: scannedDate, clientEventId, activeKey: `${person.id}:${sessionId}`,
        ...(outsideDay && options.override ? { isOverride: true, overrideNote: options.override.note } : {}),
      }, select: { id: true } });
      if (outsideDay && options.override) {
        await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "CHECKIN_OVERRIDE", target: checkIn.id, metadata: { sessionId, registrantId: person.id, dayStatus: dayRow?.status ?? "NOT_REGISTERED", note: options.override.note } } });
      }
      const prefix = outsideDay ? "อนุญาตเป็นกรณีพิเศษและเช็คชื่อแล้ว" : "เช็คชื่อสำเร็จ";
      if (event.seatMode === "whole_course") {
        const allSessions = await tx.session.findMany({ where: { eventId }, orderBy: [{ eventDay: { date: "asc" } }, { label: "asc" }], select: { id: true } });
        const checked = await tx.checkIn.count({ where: { registrantId: person.id, session: { eventId }, voidedAt: null } });
        return { kind: "success", message: `${prefix} · รอบนี้เป็นรอบที่ ${allSessions.findIndex((item) => item.id === sessionId) + 1} จาก ${allSessions.length} · เข้าแล้ว ${checked} รอบ` };
      }
      return { kind: "success", message: prefix };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (result.kind === "success") {
      revalidatePath(`/check-in/${eventId}`);
      revalidatePath(`/organizer/${eventId}/registrants`);
    }
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { kind: "duplicate", message: fromQueue ? "มีการเช็คชื่อจากเครื่องอื่นแล้ว" : "เช็คชื่อรอบนี้ไปแล้ว" };
    throw error;
  }
}

export async function checkInCode(eventId: string, sessionId: string, code: string, clientEventId?: string, scannedAt?: string): Promise<ScanResult> {
  return recordCheckIn(eventId, sessionId, code, { clientEventId, scannedAt });
}

/** Admits someone whose day is not approved; limited to owner, full collaborators and admins, with a mandatory reason. */
export async function overrideCheckIn(eventId: string, sessionId: string, code: string, note: string): Promise<ScanResult> {
  const reason = note.trim().slice(0, 500);
  if (reason.length < 3) return { kind: "wrong-day", message: "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร", canOverride: true };
  return recordCheckIn(eventId, sessionId, code, { override: { note: reason } });
}

export async function checkInPerson(eventId: string, sessionId: string, registrantId: string): Promise<ScanResult> {
  await requireEventAccess(eventId, "checkIn");
  const person = await db.registrant.findFirst({ where: { id: registrantId, eventId, status: "APPROVED" }, select: { qrCode: true } });
  return person?.qrCode ? checkInCode(eventId, sessionId, person.qrCode) : { kind: "invalid", message: "ผู้สมัครยังไม่ได้รับอนุมัติ" };
}

export async function checkInPersonForm(eventId: string, sessionId: string, registrantId: string) {
  const result = await checkInPerson(eventId, sessionId, registrantId);
  redirect(`/check-in/${eventId}?session=${sessionId}&result=${result.kind}`);
}

export async function checkInCodeForm(eventId: string, sessionId: string, formData: FormData) {
  const raw = formData.get("code");
  const result = await checkInCode(eventId, sessionId, typeof raw === "string" ? raw : "");
  redirect(`/check-in/${eventId}?session=${sessionId}&result=${result.kind}`);
}

export async function undoCheckIn(eventId: string, sessionId: string, registrantId: string) {
  const { membership, user } = await requireEventAccess(eventId, "checkIn");
  const session = await db.session.findFirst({ where: { id: sessionId, eventId }, select: { id: true } });
  if (!session) return;
  await db.$transaction(async (tx) => {
    const record = await tx.checkIn.findFirst({ where: { sessionId, registrantId, registrant: { eventId }, voidedAt: null }, select: { id: true, checkedInAt: true } });
    if (!record) return;
    const limited = membership.systemRole !== "admin" && membership.userId !== membership.ownerId && (membership.systemRole === "staff" || membership.collaboratorRole === "checkin_only");
    if (limited && Date.now() - record.checkedInAt.getTime() > 10 * 60 * 1000) return;
    await tx.checkIn.update({ where: { id: record.id }, data: { voidedAt: new Date(), voidedById: user.id, activeKey: null } });
    await tx.auditLog.create({ data: { eventId, actorId: user.id, action: requiresAdminAudit(membership) ? "CHECKIN_REVOKED_BY_ADMIN" : "CHECKIN_VOIDED", target: record.id, metadata: { sessionId, registrantId } } });
  });
  revalidatePath(`/check-in/${eventId}`);
}
