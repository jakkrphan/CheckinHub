import { createHash } from "node:crypto";

import type { Prisma, RegistrantStatus } from "@prisma/client";

import { formatEventDayWithWeekday } from "@/lib/format";

export const emailRecipientSelect = {
  id: true, email: true, status: true, statusTokenHash: true, qrCode: true, rejectReason: true,
  emailNotifiedHash: true, notifyVia: true, anonymizedAt: true,
  days: { select: { eventDayId: true, status: true } },
  event: { select: { title: true, slug: true, seatMode: true, deletedAt: true, anonymizedAt: true, days: { orderBy: { date: "asc" }, select: { id: true, date: true } } } },
} satisfies Prisma.RegistrantSelect;
export type EmailRecipient = Prisma.RegistrantGetPayload<{ select: typeof emailRecipientSelect }>;

const statusWords: Record<RegistrantStatus, string> = {
  APPROVED: "อนุมัติแล้ว", PENDING: "รอผู้จัดอนุมัติ", WAITLISTED: "อยู่ในคิวสำรอง", REJECTED: "ไม่ได้รับอนุมัติ", CANCELLED: "ยกเลิกแล้ว",
};

/** Persist a fingerprint, never a second copy of the email, reason or QR bearer code. */
export function emailSnapshot(person: EmailRecipient) {
  return createHash("sha256").update(JSON.stringify({
    email: person.email, status: person.status, reason: person.rejectReason,
    qr: person.qrCode, token: person.statusTokenHash,
    days: [...person.days].sort((a, b) => a.eventDayId.localeCompare(b.eventDayId)),
  })).digest("hex");
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export function buildEmailMessage(person: EmailRecipient, statusUrl: string) {
  const approved = person.status === "APPROVED" && person.days.some((day) => day.status === "APPROVED") && !!person.qrCode;
  const lines = [` · ${person.event.title}`, "", "ผลการลงทะเบียนของคุณ"];
  if (person.event.seatMode === "whole_course") lines.push(`หลักสูตร ${person.event.days.length} วัน: ${statusWords[person.status]}`);
  // Include the complete current state, including mixed approval/waitlist days.
  for (const [index, day] of person.event.days.entries()) {
    const selected = person.days.find((item) => item.eventDayId === day.id);
    if (selected) lines.push(`วันที่ ${index + 1} (${formatEventDayWithWeekday(day.date)}): ${statusWords[selected.status]}`);
  }
  if (person.days.some((day) => day.status === "REJECTED") && person.rejectReason) lines.push("", `เหตุผล: ${person.rejectReason}`);
  if (approved) lines.push("", "แนบ QR สำหรับเช็คชื่อแล้ว ใช้ได้เฉพาะวันที่ได้รับอนุมัติ กรุณาแสดง QR ที่จุดลงทะเบียน");
  lines.push("", `ดูสถานะล่าสุดและรายละเอียด: ${statusUrl}`, "", "ลิงก์และ QR นี้เป็นของคุณ กรุณาอย่าส่งต่อให้ผู้อื่น");
  const text = lines.join("\n");
  return {
    subject: `ผลการลงทะเบียน: ${statusWords[person.status]} · ${person.event.title}`.replace(/[\r\n]+/g, " "),
    text,
    html: `<!doctype html><html lang="th"><body><div style="font-family:Tahoma,sans-serif;line-height:1.7">${escapeHtml(text).replace(/\n/g, "<br>")}<p><a href="${escapeHtml(statusUrl)}">ดูสถานะการลงทะเบียน</a></p></div></body></html>`,
    attachQr: approved,
  };
}
