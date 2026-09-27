// Spec 1.7 + PDPA: manual waitlist promotion, bulk-approve outcome summary, displayName search, and the
// "delete my data" request from the status page through to anonymization.
import { createHash, randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = "http://localhost:3100";
const eventIds = [];

function ensure(value, message) { if (!value) throw new Error(message); }
function formsFrom(html) { return html.split("<form").slice(1).map((part) => `<form${part.split("</form>")[0]}</form>`); }
function formDataFrom(html, values) {
  const data = new FormData();
  // Cloudflare's dummy token: passes with the Turnstile test secret in .env.local, ignored when no secret is set.
  data.set("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) data.set(match[1], (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) { data.delete(key); for (const item of value) data.append(key, item); } else data.set(key, value);
  }
  return data;
}
const post = (url, form, values, headers = {}) => fetch(url, { method: "POST", redirect: "manual", headers: { origin: base, ...headers }, body: formDataFrom(form, values) });
const location = (response) => response.headers.get("location") ?? "";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
const html = async (url, cookie) => (await fetch(url, { headers: cookie ? { cookie } : {} })).text();

async function login(email, password) {
  let response = await fetch(`${base}/api/auth/csrf`);
  const csrfToken = (await response.json()).csrfToken;
  const cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  response = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${base}/organizer` }), redirect: "manual" });
  ensure(response.status === 302 && !location(response).includes("error="), `Login failed for ${email}`);
  return `${cookie}; ${response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;
}

const fields = [{ key: "name", label: "ชื่อ-นามสกุล", type: "text", required: true }];
let order = 0;
function person(eventId, name, status, days, extra = {}) {
  const token = `wp-${randomUUID()}`;
  const email = `${randomUUID()}@example.invalid`;
  order++;
  return db.registrant.create({ data: {
    eventId, email, dedupeKey: email, answers: { name }, displayName: name, status, autoApproveAtRegistration: true,
    registeredAt: new Date(Date.UTC(2031, 0, 1, 0, order)), qrCode: status === "APPROVED" ? randomUUID() : null, approvedAt: status === "APPROVED" ? new Date() : null,
    statusTokenHash: tokenHash(token), ...extra,
    days: { create: days.map(([eventDayId, dayStatus]) => ({ eventDayId, status: dayStatus, waitlistedAt: dayStatus === "WAITLISTED" ? new Date(Date.UTC(2031, 0, 1, 0, order)) : null })) },
  } }).then((row) => ({ ...row, token }));
}
async function makeEvent(title, data, dayDefs) {
  const event = await db.event.create({ data: {
    slug: `wp-${randomUUID()}`, title, ownerId: (await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" } })).id, status: "PUBLISHED",
    registrationDeadline: new Date("2031-12-31T16:59:59.999Z"), fields, ...data,
    days: { create: dayDefs.map((maxSeats, index) => ({ date: new Date(Date.UTC(2031, 9, index + 1)), maxSeats })) },
  } });
  eventIds.push(event.id);
  return { event, days: await db.eventDay.findMany({ where: { eventId: event.id }, orderBy: { date: "asc" } }) };
}

const savedSetting = await db.systemSetting.findUnique({ where: { key: "dataDeletionRequest" } });
try {
  const cookie = await login("admin@checkinhub.local", "CheckInHub123!");

  // --- Manual waitlist promotion -------------------------------------------------------------------------------
  const manual = await makeEvent("Manual queue smoke", { waitlistPromotion: "MANUAL", autoApprove: true }, [1]);
  const [day] = manual.days;
  const holder = await person(manual.event.id, "Holder Person", "APPROVED", [[day.id, "APPROVED"]]);
  const first = await person(manual.event.id, "คิวแรก สมชาย", "WAITLISTED", [[day.id, "WAITLISTED"]]);
  const second = await person(manual.event.id, "คิวสอง สมหญิง", "WAITLISTED", [[day.id, "WAITLISTED"]]);
  const listUrl = `${base}/organizer/${manual.event.id}/registrants`;
  ensure(!(await html(listUrl, cookie)).includes("มีที่นั่งว่างและมีคนรอคิว"), "Opening banner shown while full");
  await db.registrantEventDay.updateMany({ where: { registrantId: holder.id }, data: { status: "CANCELLED" } });
  await db.registrant.update({ where: { id: holder.id }, data: { status: "CANCELLED", qrCode: null } });
  let page = await html(listUrl, cookie);
  ensure(page.includes("มีที่นั่งว่างและมีคนรอคิว") && page.includes("คิวถัดไป") && page.includes("คิวแรก สมชาย"), "Opening banner missing or names the wrong person");
  ensure((await html(`${base}/organizer/${manual.event.id}/dashboard`, cookie)).includes("คิวแรก สมชาย"), "Dashboard lacks the opening banner");
  const promoteForm = formsFrom(page).find((part) => part.includes("เลื่อนคิวถัดไป"));
  let response = await post(listUrl, promoteForm, {}, { cookie });
  ensure(location(response).includes("result=promoted"), `Promotion failed: ${location(response)}`);
  ensure((await db.registrant.findUniqueOrThrow({ where: { id: first.id } })).status === "APPROVED", "First in queue not promoted");
  ensure((await db.registrant.findUniqueOrThrow({ where: { id: second.id } })).status === "WAITLISTED", "Second in queue moved too");
  ensure(await db.auditLog.count({ where: { eventId: manual.event.id, action: "WAITLIST_PROMOTED_MANUALLY", target: first.id } }) === 1, "Manual promotion not audited");
  ensure(!(await html(listUrl, cookie)).includes("มีที่นั่งว่างและมีคนรอคิว"), "Banner still shown once the day is full");
  response = await post(listUrl, promoteForm, {}, { cookie });
  ensure(location(response).includes("result=promote-none"), "A stale promote button promoted past capacity");

  // --- displayName: set on public registration, used by search ---------------------------------------------------
  const publicUrl = `${base}/events/${manual.event.slug}`;
  await db.event.update({ where: { id: manual.event.id }, data: { waitlistPromotion: "AUTO" } });
  const registrationForm = formsFrom(await html(publicUrl)).find((part) => part.includes('name="consent"'));
  await wait(3100);
  response = await post(publicUrl, registrationForm, { email: `public-${randomUUID()}@example.invalid`, dayId: day.id, "answer:name": "  ประชา ทดสอบ  ", consent: "on" }, { "x-forwarded-for": `wp-${randomUUID()}` });
  ensure(location(response).includes("/status/"), `Public registration failed: ${location(response)}`);
  ensure(await db.registrant.count({ where: { eventId: manual.event.id, displayName: "ประชา ทดสอบ" } }) === 1, "displayName not stored (trimmed) on registration");
  page = await html(`${listUrl}?q=${encodeURIComponent("ทดสอบ")}`, cookie);
  ensure(page.includes("ประชา ทดสอบ") && !page.includes("คิวสอง สมหญิง"), "Name search did not use displayName");

  // --- Bulk approval summary -------------------------------------------------------------------------------------
  const bulk = await makeEvent("Bulk summary smoke", { autoApprove: false }, [null, 1]);
  const [dayA, dayB] = bulk.days;
  await person(bulk.event.id, "Seat Holder", "APPROVED", [[dayB.id, "APPROVED"]]);
  const easy = await person(bulk.event.id, "Easy Approve", "PENDING", [[dayA.id, "PENDING"]]);
  const halfFull = await person(bulk.event.id, "Half Full", "PENDING", [[dayA.id, "PENDING"], [dayB.id, "WAITLISTED"]]);
  const changed = await person(bulk.event.id, "Changed Meanwhile", "PENDING", [[dayA.id, "PENDING"]]);
  const bulkUrl = `${base}/organizer/${bulk.event.id}/registrants`;
  const bulkForm = formsFrom(await html(bulkUrl, cookie)).find((part) => part.includes("อนุมัติที่เลือก"));
  ensure(bulkForm, "Bulk approve form missing");
  await db.registrantEventDay.updateMany({ where: { registrantId: changed.id }, data: { status: "REJECTED" } });
  await db.registrant.update({ where: { id: changed.id }, data: { status: "REJECTED" } });
  response = await post(bulkUrl, bulkForm, { registrantId: [easy.id, halfFull.id, changed.id] }, { cookie });
  const summaryUrl = new URL(location(response), base);
  ensure(summaryUrl.searchParams.get("result") === "bulk-partial" && summaryUrl.searchParams.get("held") === halfFull.id && summaryUrl.searchParams.get("skipped") === changed.id && summaryUrl.searchParams.get("approved") === "1", `Unexpected bulk result: ${summaryUrl}`);
  ensure(!summaryUrl.search.includes("Half") && !summaryUrl.search.includes("%40"), "Bulk result leaked names or emails into the URL");
  ensure((await db.registrant.findUniqueOrThrow({ where: { id: easy.id } })).status === "APPROVED", "Easy registrant not approved");
  const halfRows = await db.registrantEventDay.findMany({ where: { registrantId: halfFull.id }, orderBy: { eventDayId: "asc" } });
  ensure(halfRows.find((row) => row.eventDayId === dayA.id).status === "APPROVED" && halfRows.find((row) => row.eventDayId === dayB.id).status === "WAITLISTED", "Half-full registrant days wrong");
  page = await html(summaryUrl.toString(), cookie);
  ensure(page.includes("ยังไม่ได้อนุมัติ 2 คน") && page.includes("Half Full") && page.includes("วันที่ 2 เต็ม") && page.includes("Changed Meanwhile") && page.includes("สถานะเปลี่ยนไปก่อนกดอนุมัติ"), "Bulk summary does not explain who was not approved");

  // --- PDPA deletion request ------------------------------------------------------------------------------------
  await db.systemSetting.deleteMany({ where: { key: "dataDeletionRequest" } });
  const privacy = await makeEvent("Deletion request smoke", { waitlistPromotion: "AUTO", autoApprove: true }, [1]);
  const [pDay] = privacy.days;
  const leaver = await person(privacy.event.id, "Leaver Person", "APPROVED", [[pDay.id, "APPROVED"]]);
  const waiter = await person(privacy.event.id, "Waiting Person", "WAITLISTED", [[pDay.id, "WAITLISTED"]]);
  const statusUrl = `${base}/events/${privacy.event.slug}/status/${leaver.token}`;
  page = await html(statusUrl);
  const requestForm = formsFrom(page).find((part) => part.includes("ส่งคำขอลบข้อมูล"));
  ensure(requestForm, "Status page lacks the deletion request form");
  response = await post(statusUrl, requestForm, {});
  ensure(location(response).includes("error=delete-confirm"), "Request accepted without confirmation");
  response = await post(statusUrl, requestForm, { confirm: "on", reason: "ไม่ประสงค์ให้เก็บข้อมูล" });
  ensure(location(response).includes("deletion=requested"), `Request failed: ${location(response)}`);
  await post(statusUrl, requestForm, { confirm: "on" });
  const requests = await db.dataRequest.findMany({ where: { registrantId: leaver.id } });
  ensure(requests.length === 1 && requests[0].status === "OPEN" && requests[0].reason === "ไม่ประสงค์ให้เก็บข้อมูล", "Expected exactly one open request with the reason");
  const requestAudit = await db.auditLog.findFirst({ where: { action: "DATA_DELETION_REQUESTED", target: leaver.id } });
  ensure(requestAudit && requestAudit.actorId === null && !JSON.stringify(requestAudit.metadata).includes("ไม่ประสงค์"), "Request audit missing or contains the reason");
  ensure((await html(statusUrl)).includes("ส่งคำขอแล้ว"), "Status page does not show the pending request");

  const privacyList = `${base}/organizer/${privacy.event.id}/registrants`;
  ensure((await html(privacyList, cookie)).includes("คำขอลบข้อมูล (PDPA) รอดำเนินการ 1"), "Organizer banner for open requests missing");
  let detail = await html(`${privacyList}?selected=${leaver.id}`, cookie);
  const rejectForm = formsFrom(detail).find((part) => part.includes("ปฏิเสธคำขอ"));
  response = await post(privacyList, rejectForm, { note: "" }, { cookie });
  ensure(location(response).includes("result=delete-note"), "Rejection accepted without a reason");
  response = await post(privacyList, rejectForm, { note: "ต้องเก็บหลักฐานการเบิกจ่าย" }, { cookie });
  ensure(location(response).includes("result=delete-rejected"), `Rejection failed: ${location(response)}`);
  ensure((await html(statusUrl)).includes("ต้องเก็บหลักฐานการเบิกจ่าย"), "Registrant cannot see why the request was declined");

  // Asked again; this time the organizer deletes. The freed seat goes to the queue.
  response = await post(statusUrl, formsFrom(await html(statusUrl)).find((part) => part.includes("ส่งคำขอลบข้อมูล")), { confirm: "on" });
  ensure(location(response).includes("deletion=requested"), "Second request failed");
  detail = await html(`${privacyList}?selected=${leaver.id}`, cookie);
  const completeForm = formsFrom(detail).find((part) => part.includes("ลบข้อมูลตามคำขอ"));
  response = await post(privacyList, completeForm, {}, { cookie });
  ensure(location(response).includes("result=delete-confirm"), "Deletion ran without confirmation");
  response = await post(privacyList, completeForm, { confirm: "on" }, { cookie });
  ensure(location(response).includes("result=deleted"), `Deletion failed: ${location(response)}`);
  const erased = await db.registrant.findUniqueOrThrow({ where: { id: leaver.id } });
  ensure(erased.anonymizedAt && erased.email === null && erased.displayName === null && JSON.stringify(erased.answers) === "{}" && erased.status === "CANCELLED" && erased.qrCode === null, "Registrant not anonymized and cancelled");
  const done = await db.dataRequest.findFirst({ where: { registrantId: leaver.id, status: "COMPLETED" } });
  ensure(done && done.reason === null && done.resolvedById, "Completed request not recorded (or kept the reason)");
  ensure((await db.registrant.findUniqueOrThrow({ where: { id: waiter.id } })).status === "APPROVED", "Freed seat not given to the queue");
  ensure((await fetch(statusUrl)).status === 404, "Old status link still works after deletion");

  // The admin switch hides the channel.
  await db.systemSetting.create({ data: { key: "dataDeletionRequest", enabled: false } });
  ensure(!(await html(`${base}/events/${privacy.event.slug}/status/${waiter.token}`)).includes("ส่งคำขอลบข้อมูล"), "Deletion form shown while switched off");

  console.log("Waitlist & privacy: manual promotion, bulk-approve summary, displayName search and PDPA deletion requests passed.");
} finally {
  await db.systemSetting.deleteMany({ where: { key: "dataDeletionRequest" } });
  if (savedSetting) await db.systemSetting.create({ data: savedSetting });
  for (const id of eventIds) await db.event.deleteMany({ where: { id } });
  await db.$disconnect();
}
