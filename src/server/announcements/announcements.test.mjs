// Unit tests for announcements: which channel each person gets, the counts on the compose form, and the message content.
import assert from "node:assert/strict";
import test from "node:test";

import { buildAnnouncementEmail } from "../email/message.ts";
import { buildLineAnnouncement } from "../line/message.ts";
import { channelsFor, countReach, parseAudience, scheduleChangeDraft } from "./audience.ts";

const person = (overrides = {}) => ({ email: "a@example.test", lineUserId: null, notifyVia: "EMAIL", ...overrides });

test("each person gets the channel they chose", () => {
  assert.deepEqual(channelsFor(person(), true), { line: false, email: true });
  assert.deepEqual(channelsFor(person({ notifyVia: "LINE", lineUserId: "U1" }), true), { line: true, email: false });
  assert.deepEqual(channelsFor(person({ notifyVia: "BOTH", lineUserId: "U1" }), true), { line: true, email: true });
  // Chose email but connected LINE anyway: still email.
  assert.deepEqual(channelsFor(person({ lineUserId: "U1" }), true), { line: false, email: true });
});

test("LINE chooser falls back to email when LINE is off or never connected", () => {
  assert.deepEqual(channelsFor(person({ notifyVia: "LINE", lineUserId: "U1" }), false), { line: false, email: true });
  assert.deepEqual(channelsFor(person({ notifyVia: "LINE" }), true), { line: false, email: true });
});

test("no email and no reachable LINE means nobody can be told", () => {
  assert.deepEqual(channelsFor(person({ email: null, notifyVia: "LINE" }), true), { line: false, email: false });
  assert.deepEqual(channelsFor(person({ email: null, notifyVia: "LINE", lineUserId: "U1" }), false), { line: false, email: false });
  // No email at all: LINE even if the stored choice says email.
  assert.deepEqual(channelsFor(person({ email: null, lineUserId: "U1" }), true), { line: true, email: false });
});

test("reach counts people, messages per channel and the unreachable", () => {
  const reach = countReach([person(), person({ notifyVia: "LINE", lineUserId: "U1" }), person({ notifyVia: "BOTH", lineUserId: "U2" }), person({ email: null, notifyVia: "LINE" })], true);
  assert.deepEqual(reach, { people: 4, line: 2, email: 2, unreachable: 1 });
});

test("audience keeps only statuses an organizer may address", () => {
  assert.deepEqual(parseAudience(["WAITLISTED", "REJECTED", "APPROVED", "x"]), ["APPROVED", "WAITLISTED"]);
});

test("schedule-change drafts are ready to send", () => {
  assert.match(scheduleChangeDraft("added").subject, /เพิ่มวัน/);
  assert.match(scheduleChangeDraft("removed").body, /ยกเลิกวันอบรม/);
});

const recipient = {
  id: "r1", email: "a@example.test", displayName: "สมชาย", status: "APPROVED", statusTokenHash: "h", qrCode: "RPP-7Q2M-4KX9", rejectReason: null,
  emailNotifiedHash: null, notifyVia: "EMAIL", lineUserId: null, anonymizedAt: null, days: [],
  event: { title: "อบรม <ทดสอบ>", location: null, slug: "demo", seatMode: "per_day", deletedAt: null, anonymizedAt: null, days: [] },
};
const announcement = { subject: "เปลี่ยนห้อง", body: "ย้ายไปห้อง 301\nเวลาเดิม <09:00>" };
const url = "https://example.test/events/demo/status/t";

test("email: escaped subject/body, a status button, and never the QR", () => {
  const message = buildAnnouncementEmail(recipient, announcement, url);
  assert.match(message.subject, /ประกาศ: เปลี่ยนห้อง · อบรม <ทดสอบ>/);
  assert.equal(message.attachQr, false);
  assert.ok(message.html.includes("เวลาเดิม &lt;09:00&gt;") && message.html.includes("อบรม &lt;ทดสอบ&gt;"));
  assert.ok(!message.html.includes("cid:") && !message.html.includes("RPP-7Q2M-4KX9"));
  assert.ok(message.html.includes(url) && message.text.includes(url) && message.text.includes("ย้ายไปห้อง 301"));
});

test("LINE: a card with the announcement and a button to the status page", () => {
  const message = buildLineAnnouncement(recipient, announcement, url);
  assert.equal(message.type, "flex");
  assert.match(message.altText, /^ประกาศ: เปลี่ยนห้อง/);
  const texts = message.contents.body.contents.map((part) => part.text);
  assert.ok(texts.includes("เปลี่ยนห้อง") && texts.includes(announcement.body));
  assert.deepEqual(message.contents.footer.contents[0].action, { type: "uri", label: "ดูสถานะและ QR", uri: url });
});
