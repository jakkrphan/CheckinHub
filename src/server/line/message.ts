import type { Prisma, RegistrantStatus } from "@prisma/client";

import { formatEventDayWithWeekday } from "@/lib/format";

// Text of the LINE messages (kept free of Next.js/database imports so it can be unit-tested on its own).

export type LineNotificationKind = "linked" | "status" | "resend";

const statusWords: Record<RegistrantStatus, string> = {
  APPROVED: "ได้รับอนุมัติ ✅",
  PENDING: "รอผู้จัดอนุมัติ",
  WAITLISTED: "อยู่ในคิวสำรอง",
  REJECTED: "ไม่ได้รับอนุมัติ",
  CANCELLED: "ยกเลิกแล้ว",
};

export type Recipient = Prisma.RegistrantGetPayload<{ select: typeof recipientSelect }>;
export const recipientSelect = {
  id: true, status: true, statusTokenHash: true, lineUserId: true, lineNotifiedDays: true, rejectReason: true, anonymizedAt: true,
  days: { select: { eventDayId: true, status: true } },
  event: { select: { title: true, slug: true, seatMode: true, deletedAt: true, days: { orderBy: { date: "asc" }, select: { id: true, date: true } } } },
} satisfies Prisma.RegistrantSelect;

export function snapshotOf(person: Recipient) {
  return Object.fromEntries(person.days.map((day) => [day.eventDayId, day.status]));
}

/** The message text, or null when a "status" message has nothing new to say. */
export function buildLineMessage(kind: LineNotificationKind, person: Recipient, statusUrl: string) {
  const previous = (person.lineNotifiedDays && typeof person.lineNotifiedDays === "object" && !Array.isArray(person.lineNotifiedDays) ? person.lineNotifiedDays : {}) as Record<string, string>;
  const course = person.event.seatMode === "whole_course";
  const order = person.event.days;
  const dayLine = (eventDayId: string, status: RegistrantStatus) => {
    const index = order.findIndex((day) => day.id === eventDayId);
    return `• วันที่ ${index + 1} (${index >= 0 ? formatEventDayWithWeekday(order[index].date) : "-"}): ${statusWords[status]}`;
  };
  const days = [...person.days].sort((a, b) => order.findIndex((day) => day.id === a.eventDayId) - order.findIndex((day) => day.id === b.eventDayId));
  const changed = kind === "status" ? days.filter((day) => previous[day.eventDayId] !== day.status) : days;
  if (!changed.length) return null;

  const lines = [`CheckInHub · ${person.event.title}`, ""];
  if (kind === "linked") lines.push("เชื่อม LINE สำเร็จ — ระบบจะแจ้งผลการลงทะเบียนทางนี้", "");
  lines.push(kind === "status" ? "อัปเดตสถานะการลงทะเบียน" : "สถานะการลงทะเบียนของคุณ");
  // A whole course moves as one; list it once instead of repeating the same status for every day.
  if (course) lines.push(`• หลักสูตร ${order.length} วัน: ${statusWords[person.status]}`);
  else lines.push(...changed.map((day) => dayLine(day.eventDayId, day.status)));
  if (changed.some((day) => day.status === "REJECTED") && person.rejectReason) lines.push("", `เหตุผล: ${person.rejectReason}`);
  lines.push("", person.status === "APPROVED" ? `QR สำหรับเช็คชื่อ (แสดงที่จุดลงทะเบียน):\n${statusUrl}` : `ดูรายละเอียด:\n${statusUrl}`);
  return lines.join("\n");
}
