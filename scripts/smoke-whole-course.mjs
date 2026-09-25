import { randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = "http://localhost:3100";
const SEATS = 10;
const REQUESTS = 50;
let eventId;

function ensure(value, message) { if (!value) throw new Error(message); }
function formsFrom(html) { return html.split("<form").slice(1).map((part) => `<form${part.split("</form>")[0]}</form>`); }
function formDataFrom(html, values) {
  const data = new FormData();
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) data.set(match[1], (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const post = (url, form, values, headers = {}) => fetch(url, { method: "POST", redirect: "manual", headers: { origin: base, ...headers }, body: formDataFrom(form, values) });

async function login(email, password) {
  let response = await fetch(`${base}/api/auth/csrf`);
  const csrfToken = (await response.json()).csrfToken;
  let cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  response = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${base}/organizer` }), redirect: "manual" });
  ensure(response.status === 302, "Admin login failed");
  return `${cookie}; ${response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;
}

/** Every day row of a whole-course registrant must carry the person's status. */
async function assertRowsMatchPeople() {
  const people = await db.registrant.findMany({ where: { eventId }, select: { id: true, status: true, days: { select: { status: true } } } });
  for (const person of people) {
    ensure(person.days.length === 3 && person.days.every((day) => day.status === person.status), `Day rows diverged for ${person.id}: ${person.status} vs ${person.days.map((day) => day.status).join(",")}`);
  }
  return people;
}

const countBy = async () => Object.fromEntries((await db.registrant.groupBy({ by: ["status"], where: { eventId }, _count: true })).map((row) => [row.status, row._count]));

try {
  const suffix = randomUUID();
  const owner = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" }, select: { id: true } });
  const event = await db.event.create({ data: {
    slug: `whole-course-smoke-${suffix}`, title: "Whole course smoke", ownerId: owner.id,
    status: "PUBLISHED", autoApprove: true, waitlistPromotion: "AUTO", seatMode: "whole_course", maxSeats: SEATS, attendanceThreshold: 80,
    registrationDeadline: new Date("2031-12-31T16:59:59.999Z"),
    fields: [{ key: "name", label: "ชื่อ", type: "text", required: true }],
    days: { create: ["2031-12-01", "2031-12-02", "2031-12-03"].map((date) => ({ date: new Date(`${date}T00:00:00.000Z`) })) },
  } });
  eventId = event.id;
  const days = await db.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" } });
  for (const day of days) for (const label of ["เช้า", "บ่าย"]) await db.session.create({ data: { eventId, eventDayId: day.id, label } });
  const sessions = await db.session.findMany({ where: { eventId }, orderBy: [{ eventDay: { date: "asc" } }, { label: "asc" }] });

  const publicUrl = `${base}/events/${event.slug}`;
  const html = await (await fetch(publicUrl)).text();
  ensure(html.includes(`เหลือ ${SEATS}`) || html.includes(`${SEATS} ที่นั่ง`) || html.includes(String(SEATS)), "Public page did not show course capacity");
  const form = formsFrom(html).find((part) => part.includes('name="consent"'));
  ensure(form && !form.includes('name="dayId"'), "Whole-course form must not offer day checkboxes");
  await new Promise((resolve) => setTimeout(resolve, 3100));

  // 50 people race for 10 seats; each request comes from its own IP so the per-IP limit is not what stops them.
  const responses = await Promise.all(Array.from({ length: REQUESTS }, (_, index) => post(publicUrl, form, {
    email: `course-${index}-${suffix}@example.invalid`, "answer:name": `Learner ${index}`, consent: "on",
  }, { "x-forwarded-for": `wc-${index}-${suffix}` })));
  const failures = responses.filter((response) => response.status !== 303 || !response.headers.get("location")?.includes("/status/"));
  ensure(!failures.length, `Concurrent whole-course submits failed: ${failures.map((response) => `${response.status}:${response.headers.get("location")}`).join(", ")}`);
  let counts = await countBy();
  ensure(counts.APPROVED === SEATS && counts.WAITLISTED === REQUESTS - SEATS, `Course capacity race: ${JSON.stringify(counts)}`);
  await assertRowsMatchPeople();
  ensure(await db.registrant.count({ where: { eventId, status: "APPROVED", qrCode: { not: null } } }) === SEATS, "Approved learners did not each get one QR code");
  ensure(await db.registrantEventDay.count({ where: { registrant: { eventId } } }) === REQUESTS * 3, "Whole-course registration did not attach every day");
  const statusUrls = new Map(responses.map((response, index) => [`course-${index}-${suffix}@example.invalid`, new URL(response.headers.get("location"), base)]));

  // Check-in shows the learner's position in the course.
  const cookie = await login("admin@checkinhub.local", "CheckInHub123!");
  const learner = await db.registrant.findFirstOrThrow({ where: { eventId, status: "APPROVED" }, orderBy: { registeredAt: "asc" } });
  const checkInUrl = `${base}/check-in/${eventId}?session=${sessions[0].id}`;
  const checkInHtml = await (await fetch(checkInUrl, { headers: { cookie } })).text();
  const scanForm = formsFrom(checkInHtml).find((part) => part.includes('name="code"') && part.includes("$ACTION_"));
  let response = await post(checkInUrl, scanForm, { code: learner.qrCode }, { cookie });
  ensure(response.headers.get("location")?.includes("result=success"), `Whole-course check-in failed: ${response.headers.get("location")}`);

  // Organizer rejects a waitlisted learner as a whole, with a reason visible on the status page.
  const organizerUrl = `${base}/organizer/${eventId}/registrants`;
  const waitlisted = await db.registrant.findFirstOrThrow({ where: { eventId, status: "WAITLISTED" }, orderBy: { registeredAt: "desc" } });
  let page = await (await fetch(`${organizerUrl}?q=${encodeURIComponent(waitlisted.email)}`, { headers: { cookie } })).text();
  ensure(!page.includes("ปฏิเสธวันนี้") && !page.includes("อนุมัติวันนี้"), "Whole-course list rendered per-day decision buttons");
  const rejectForm = formsFrom(page).find((part) => part.includes("ยืนยันปฏิเสธ"));
  ensure(rejectForm, "Reject form missing");
  response = await post(organizerUrl, rejectForm, { reason: "เอกสารไม่ครบ" }, { cookie });
  const rejected = await db.registrant.findUniqueOrThrow({ where: { id: waitlisted.id } });
  ensure(rejected.status === "REJECTED" && rejected.rejectReason === "เอกสารไม่ครบ" && rejected.dedupeKey === null, "Whole-course rejection did not store reason or release dedupe key");
  ensure((await (await fetch(statusUrls.get(waitlisted.email))).text()).includes("เอกสารไม่ครบ"), "Reject reason missing from status page");

  // Organizer revokes an approved learner without check-ins; the first waitlisted learner is promoted as a whole.
  const queueHead = await db.registrantEventDay.findFirstOrThrow({ where: { status: "WAITLISTED", eventDay: { eventId } }, orderBy: [{ waitlistedAt: "asc" }, { id: "asc" }], select: { registrantId: true } });
  const revoked = await db.registrant.findFirstOrThrow({ where: { eventId, status: "APPROVED", id: { not: learner.id } }, orderBy: { registeredAt: "desc" } });
  page = await (await fetch(`${organizerUrl}?q=${encodeURIComponent(revoked.email)}`, { headers: { cookie } })).text();
  const revokeForm = formsFrom(page).find((part) => part.includes("ยกเลิกการเข้าร่วม"));
  ensure(revokeForm, "Revoke form missing");
  await post(organizerUrl, revokeForm, {}, { cookie });
  ensure((await db.registrant.findUniqueOrThrow({ where: { id: revoked.id } })).status === "CANCELLED", "Revoke did not cancel the learner");
  ensure((await db.registrant.findUniqueOrThrow({ where: { id: queueHead.registrantId } })).status === "APPROVED", "Revoke did not promote the head of the course waitlist");
  counts = await countBy();
  ensure(counts.APPROVED === SEATS, `Seat count drifted after promotion: ${JSON.stringify(counts)}`);

  // A learner who already checked in cannot be revoked (history would be orphaned).
  page = await (await fetch(`${organizerUrl}?q=${encodeURIComponent(learner.email)}`, { headers: { cookie } })).text();
  await post(organizerUrl, formsFrom(page).find((part) => part.includes("ยกเลิกการเข้าร่วม")), {}, { cookie });
  ensure((await db.registrant.findUniqueOrThrow({ where: { id: learner.id } })).status === "APPROVED", "Learner with check-ins was revoked");

  // Self-cancellation cancels the whole course and promotes the next learner.
  const selfCancel = await db.registrant.findFirstOrThrow({ where: { eventId, status: "APPROVED", id: { notIn: [learner.id] } }, orderBy: { registeredAt: "asc" } });
  const nextHead = await db.registrantEventDay.findFirstOrThrow({ where: { status: "WAITLISTED", eventDay: { eventId } }, orderBy: [{ waitlistedAt: "asc" }, { id: "asc" }], select: { registrantId: true } });
  const statusUrl = statusUrls.get(selfCancel.email);
  const statusHtml = await (await fetch(statusUrl)).text();
  const cancelForms = formsFrom(statusHtml).filter((part) => part.includes('name="confirm"'));
  ensure(cancelForms.length === 1 && !cancelForms[0].includes('name="eventDayId"'), "Whole-course status page offered per-day cancellation");
  response = await post(statusUrl.toString(), cancelForms[0], { confirm: "on" });
  ensure(response.status === 303, `Self-cancellation failed: ${response.status}`);
  ensure((await db.registrant.findUniqueOrThrow({ where: { id: selfCancel.id } })).status === "CANCELLED", "Self-cancellation did not cancel the course");
  ensure((await db.registrant.findUniqueOrThrow({ where: { id: nextHead.registrantId } })).status === "APPROVED", "Self-cancellation did not promote the next learner");
  await assertRowsMatchPeople();

  // The cancelled learner may register again (dedupe key released) and joins the back of the queue.
  const freshHtml = await (await fetch(publicUrl)).text();
  const freshForm = formsFrom(freshHtml).find((part) => part.includes('name="consent"'));
  await new Promise((resolve) => setTimeout(resolve, 3100));
  response = await post(publicUrl, freshForm, { email: selfCancel.email, "answer:name": "Returning learner", consent: "on" }, { "x-forwarded-for": `wc-return-${suffix}` });
  ensure(response.headers.get("location")?.includes("/status/"), `Re-registration after cancellation failed: ${response.headers.get("location")}`);
  ensure(await db.registrant.count({ where: { eventId, email: selfCancel.email } }) === 2 && (await db.registrant.findFirstOrThrow({ where: { eventId, email: selfCancel.email, status: "WAITLISTED" } })), "Returning learner was not waitlisted as a new registration");
  response = await post(publicUrl, freshForm, { email: selfCancel.email, "answer:name": "Duplicate", consent: "on" }, { "x-forwarded-for": `wc-dup-${suffix}` });
  ensure(response.headers.get("location")?.includes("error=duplicate"), "Active duplicate registration was accepted");

  counts = await countBy();
  ensure(counts.APPROVED === SEATS, `Final seat count incorrect: ${JSON.stringify(counts)}`);
  await assertRowsMatchPeople();
  process.stdout.write(`Whole-course: ${REQUESTS} concurrent submits filled ${SEATS} seats exactly; reject/revoke/self-cancel moved every day row together and promoted the queue in order; re-registration after cancellation worked.\n`);
} finally {
  if (eventId) await db.event.delete({ where: { id: eventId } });
  await db.$disconnect();
}
