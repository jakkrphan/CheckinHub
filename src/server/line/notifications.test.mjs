// Unit tests for the LINE message card: which days a message mentions and what it says, without calling LINE.
import assert from "node:assert/strict";
import test from "node:test";

import { buildLineFlexMessage } from "./message.ts";

const days = [{ id: "day1", date: new Date("2031-12-01T00:00:00Z") }, { id: "day2", date: new Date("2031-12-02T00:00:00Z") }];
const person = (overrides = {}) => ({
  id: "r1", status: "APPROVED", statusTokenHash: "x", lineUserId: "U0", anonymizedAt: null, rejectReason: null, lineNotifiedDays: null,
  days: [{ eventDayId: "day1", status: "APPROVED" }, { eventDayId: "day2", status: "WAITLISTED" }],
  event: { title: "อบรมทดสอบ", slug: "demo", seatMode: "per_day", deletedAt: null, days },
  ...overrides,
});
const url = "https://example.test/events/demo/status/l.r1.sig";

// Every text component of the card body, one per line (a day row's label and status share a line).
const bodyText = (message) => message.contents.body.contents.map((part) => part.type === "box" ? part.contents.map((cell) => cell.text).join(": ") : part.text ?? "").join("\n");
const button = (message) => message.contents.footer.contents[0].action;

test("linked: lists every day with its status and a button to the QR", () => {
  const message = buildLineFlexMessage("linked", person(), url);
  assert.equal(message.type, "flex");
  const text = bodyText(message);
  assert.match(text, /เชื่อม LINE สำเร็จ/);
  assert.match(text, /วันที่ 1 .*ได้รับอนุมัติ/);
  assert.match(text, /วันที่ 2 .*อยู่ในคิวสำรอง/);
  assert.deepEqual(button(message), { type: "uri", label: "เปิด QR สำหรับเช็คชื่อ", uri: url });
  assert.match(message.altText, /อบรมทดสอบ/);
  assert.ok(message.altText.length <= 400);
});

test("status: only the days that changed since the last message", () => {
  const text = bodyText(buildLineFlexMessage("status", person({ lineNotifiedDays: { day1: "PENDING", day2: "WAITLISTED" } }), url));
  assert.match(text, /อัปเดตสถานะ/);
  assert.match(text, /วันที่ 1 .*ได้รับอนุมัติ/);
  assert.doesNotMatch(text, /วันที่ 2/);
});

test("status: nothing new means no message (no quota spent)", () => {
  assert.equal(buildLineFlexMessage("status", person({ lineNotifiedDays: { day1: "APPROVED", day2: "WAITLISTED" } }), url), null);
});

test("rejection carries the organizer's reason and a details button instead of a QR", () => {
  const message = buildLineFlexMessage("status", person({ status: "REJECTED", rejectReason: "คุณสมบัติไม่ตรง", days: [{ eventDayId: "day1", status: "REJECTED" }], lineNotifiedDays: { day1: "PENDING" } }), url);
  const text = bodyText(message);
  assert.match(text, /ไม่ได้รับอนุมัติ/);
  assert.match(text, /เหตุผล: คุณสมบัติไม่ตรง/);
  assert.equal(button(message).label, "ดูรายละเอียด");
  assert.doesNotMatch(`${text}\n${message.altText}`, /QR/);
});

test("whole course: one line for the course, not one per day", () => {
  const text = bodyText(buildLineFlexMessage("status", person({ status: "PENDING", days: [{ eventDayId: "day1", status: "PENDING" }, { eventDayId: "day2", status: "PENDING" }], lineNotifiedDays: { day1: "WAITLISTED", day2: "WAITLISTED" }, event: { title: "หลักสูตร", slug: "c", seatMode: "whole_course", deletedAt: null, days } }), url));
  assert.match(text, /หลักสูตร 2 วัน: รอผู้จัดอนุมัติ/);
  assert.doesNotMatch(text, /วันที่ 1/);
});
