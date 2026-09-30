// Unit tests for the LINE message text: which days a message mentions and what it says, without calling LINE.
import assert from "node:assert/strict";
import test from "node:test";

import { buildLineMessage } from "./message.ts";

const days = [{ id: "day1", date: new Date("2031-12-01T00:00:00Z") }, { id: "day2", date: new Date("2031-12-02T00:00:00Z") }];
const person = (overrides = {}) => ({
  id: "r1", status: "APPROVED", statusTokenHash: "x", lineUserId: "U0", anonymizedAt: null, rejectReason: null, lineNotifiedDays: null,
  days: [{ eventDayId: "day1", status: "APPROVED" }, { eventDayId: "day2", status: "WAITLISTED" }],
  event: { title: "อบรมทดสอบ", slug: "demo", seatMode: "per_day", deletedAt: null, days },
  ...overrides,
});
const url = "https://example.test/events/demo/status/l.r1.sig";

test("linked: lists every day with its status and the QR link", () => {
  const text = buildLineMessage("linked", person(), url);
  assert.match(text, /เชื่อม LINE สำเร็จ/);
  assert.match(text, /วันที่ 1 .*ได้รับอนุมัติ/);
  assert.match(text, /วันที่ 2 .*อยู่ในคิวสำรอง/);
  assert.match(text, /QR สำหรับเช็คชื่อ/);
  assert.ok(text.includes(url));
});

test("status: only the days that changed since the last message", () => {
  const text = buildLineMessage("status", person({ lineNotifiedDays: { day1: "PENDING", day2: "WAITLISTED" } }), url);
  assert.match(text, /อัปเดตสถานะ/);
  assert.match(text, /วันที่ 1 .*ได้รับอนุมัติ/);
  assert.doesNotMatch(text, /วันที่ 2/);
});

test("status: nothing new means no message (no quota spent)", () => {
  assert.equal(buildLineMessage("status", person({ lineNotifiedDays: { day1: "APPROVED", day2: "WAITLISTED" } }), url), null);
});

test("rejection carries the organizer's reason and a details link instead of a QR", () => {
  const text = buildLineMessage("status", person({ status: "REJECTED", rejectReason: "คุณสมบัติไม่ตรง", days: [{ eventDayId: "day1", status: "REJECTED" }], lineNotifiedDays: { day1: "PENDING" } }), url);
  assert.match(text, /ไม่ได้รับอนุมัติ/);
  assert.match(text, /เหตุผล: คุณสมบัติไม่ตรง/);
  assert.match(text, /ดูรายละเอียด/);
  assert.doesNotMatch(text, /QR/);
});

test("whole course: one line for the course, not one per day", () => {
  const text = buildLineMessage("status", person({ status: "PENDING", days: [{ eventDayId: "day1", status: "PENDING" }, { eventDayId: "day2", status: "PENDING" }], lineNotifiedDays: { day1: "WAITLISTED", day2: "WAITLISTED" }, event: { title: "หลักสูตร", slug: "c", seatMode: "whole_course", deletedAt: null, days } }), url);
  assert.match(text, /หลักสูตร 2 วัน: รอผู้จัดอนุมัติ/);
  assert.doesNotMatch(text, /วันที่ 1/);
});
