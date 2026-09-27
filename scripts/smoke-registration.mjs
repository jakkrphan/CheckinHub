import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = "http://localhost:3100";
const smokeIp = `smoke-${randomUUID()}`;
let eventId;
let staffId;
let fullId;
const uploadedKeys = [];

function ensure(value, message) { if (!value) throw new Error(message); }
function formsFrom(html) { return html.split("<form").slice(1).map((part) => `<form${part.split("</form>")[0]}</form>`); }
function formDataFrom(html, values = {}) {
  const form = new FormData();
  // Cloudflare's dummy token: passes with the Turnstile test secret in .env.local, ignored when no secret is set.
  form.set("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) {
    form.set(match[1], (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  }
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) { form.delete(name); for (const item of value) form.append(name, item); }
    else form.set(name, value);
  }
  return form;
}
async function submit(url, html, values = {}, cookie = "") {
  return fetch(url, { method: "POST", headers: { origin: base, "x-forwarded-for": smokeIp, ...(cookie ? { cookie } : {}) }, body: formDataFrom(html, values), redirect: "manual" });
}

try {
  const suffix = randomUUID();
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" } });
  const event = await db.event.create({ data: {
    slug: `registration-smoke-${suffix}`, title: "Registration smoke", ownerId: admin.id, status: "PUBLISHED",
    registrationDeadline: new Date("2031-12-31T16:59:59.999Z"), autoApprove: false, waitlistPromotion: "AUTO",
    fields: [
      { key: "name", label: "ชื่อ", type: "text", required: true, showOnCheckin: true },
      { key: "secret", label: "ข้อมูลภายใน", type: "text", required: false, sensitive: true },
      { key: "proof", label: "หลักฐาน", type: "file", required: false, sensitive: true, acceptedFileTypes: ["pdf"], maxFileSizeMb: 1 },
    ],
    days: { create: [{ date: new Date("2031-12-30T00:00:00.000Z"), maxSeats: 1 }] },
  } });
  eventId = event.id;
  const staffEmail = `checkin-staff-${suffix}@example.invalid`;
  const staffPassword = "LocalCheckIn123!";
  const staff = await db.user.create({ data: { name: "Check-in staff smoke", email: staffEmail, passwordHash: await hash(staffPassword, 10), role: "STAFF" } });
  staffId = staff.id;
  await db.eventOrganizer.create({ data: { eventId, userId: staff.id, role: "CHECKIN_ONLY" } });
  const fullEmail = `full-organizer-${suffix}@example.invalid`;
  const fullPassword = "LocalOrganizer123!";
  const full = await db.user.create({ data: { name: "Full organizer smoke", email: fullEmail, passwordHash: await hash(fullPassword, 10), role: "ORGANIZER" } });
  fullId = full.id;
  await db.eventOrganizer.create({ data: { eventId, userId: full.id, role: "FULL" } });
  const day = await db.eventDay.findFirstOrThrow({ where: { eventId } });
  const session = await db.session.create({ data: { eventId, eventDayId: day.id, label: "เช้า" } });
  const otherDay = await db.eventDay.create({ data: { eventId, date: new Date("2031-12-31T00:00:00.000Z"), maxSeats: 1 } });
  const otherSession = await db.session.create({ data: { eventId, eventDayId: otherDay.id, label: "วันที่สอง" } });
  const publicUrl = `${base}/events/${event.slug}`;
  let html = await (await fetch(publicUrl)).text();
  const registrationForm = formsFrom(html).find((form) => form.includes('name="consent"'));
  ensure(registrationForm, "Public registration form missing");
  // The server rejects forms submitted less than 3 seconds after they were rendered.
  await new Promise((resolve) => setTimeout(resolve, 3100));
  const statusUrls = [];
  for (let index = 1; index <= 2; index++) {
    const values = { email: `attendee${index}-${suffix}@example.invalid`, dayId: day.id, "answer:name": `Person ${index}`, consent: "on" };
    if (index === 1) values["answer:proof"] = new File(["%PDF-1.7\nlocal smoke attachment\n"], "proof.pdf", { type: "application/pdf" });
    if (index === 2) values["answer:secret"] = `PRIVATE-${suffix}`;
    const response = await submit(publicUrl, registrationForm, values);
    ensure(response.status === 303 && response.headers.get("location")?.includes("/status/"), `Registration ${index} failed: ${response.status}`);
    statusUrls.push(response.headers.get("location"));
  }
  const people = await db.registrant.findMany({ where: { eventId }, orderBy: { registeredAt: "asc" } });
  const first = people.find((person) => person.email?.startsWith("attendee1-"));
  const second = people.find((person) => person.email?.startsWith("attendee2-"));
  ensure(people.length === 2 && first?.status === "PENDING" && second?.status === "WAITLISTED", "Capacity/waitlist incorrect");
  const proof = first.answers?.proof;
  ensure(proof?.originalName === "proof.pdf" && proof?.contentType === "application/pdf", "Local file metadata missing");
  uploadedKeys.push(proof.storageKey);

  let response = await fetch(`${base}/api/auth/csrf`);
  const csrfToken = (await response.json()).csrfToken;
  let cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  response = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken, email: admin.email, password: "CheckInHub123!", callbackUrl: `${base}/organizer` }), redirect: "manual" });
  ensure(response.status === 302, "Admin login failed");
  cookie += `; ${response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;
  const organizerUrl = `${base}/organizer/${eventId}/registrants`;
  const fileDownload = await fetch(`${organizerUrl}/${first.id}/files/proof`, { headers: { cookie } });
  ensure(fileDownload.status === 200 && fileDownload.headers.get("cache-control") === "private, no-store" && (await fileDownload.text()).startsWith("%PDF-"), "Authorized private file download failed");
  ensure(await db.auditLog.count({ where: { eventId, action: "FILE_DOWNLOADED", target: first.id } }) === 1, "Private file download was not audited");
  html = await (await fetch(organizerUrl, { headers: { cookie } })).text();
  ensure(!html.includes(`PRIVATE-${suffix}`) && html.includes("เปิดดูข้อมูลอ่อนไหว"), "Sensitive answer leaked into the registrant list");
  const sensitivePage = await fetch(`${organizerUrl}/${second.id}/sensitive/secret`, { headers: { cookie } });
  ensure(sensitivePage.status === 200 && (await sensitivePage.text()).includes(`PRIVATE-${suffix}`) && await db.auditLog.count({ where: { eventId, action: "SENSITIVE_ANSWER_VIEWED", target: second.id } }) === 1, "Sensitive answer view was not protected or audited");
  const plainCsv = await (await fetch(`${organizerUrl}/export`, { headers: { cookie } })).text();
  const sensitiveCsv = await (await fetch(`${organizerUrl}/export?includeSensitive=on`, { headers: { cookie } })).text();
  ensure(!plainCsv.includes(`PRIVATE-${suffix}`) && sensitiveCsv.includes(`PRIVATE-${suffix}`) && await db.auditLog.count({ where: { eventId, action: "EXPORT_CSV" } }) === 2, "Sensitive CSV export policy or audit failed");
  const filteredUrl = `${organizerUrl}?q=${encodeURIComponent("Person 1")}&status=PENDING&day=${day.id}&field=name&answer=${encodeURIComponent("Person 1")}`;
  const filteredHtml = await (await fetch(filteredUrl, { headers: { cookie } })).text();
  ensure(filteredHtml.includes(first.email) && !filteredHtml.includes(second.email), "Registrant search/day/answer filters did not narrow results");
  ensure(html.includes(first.email), "First applicant missing from organizer list");
  // The registrant page is master-detail: decisions live in the selected person's detail panel.
  const detail = async (id) => (await fetch(`${organizerUrl}?selected=${id}`, { headers: { cookie } })).text();
  const approveFormIn = (page) => formsFrom(page).find((form) => form.includes('name="returnTo"') && form.includes("อนุมัติ") && !form.includes("วันนี้") && !form.includes('name="reason"') && !form.includes('name="registrantId"') && !form.includes("ออกลิงก์"));
  html = await detail(first.id);
  const rejectForm = formsFrom(html).find((form) => form.includes("ยืนยันปฏิเสธ"));
  ensure(rejectForm, "Reject form missing");
  response = await submit(organizerUrl, rejectForm, {}, cookie);
  ensure(response.status === 303, `Reject failed: ${response.status}`);
  const after = await db.registrant.findMany({ where: { eventId }, orderBy: { registeredAt: "asc" } });
  const promoted = after.find((person) => person.id === second.id);
  ensure(after.find((person) => person.id === first.id)?.status === "REJECTED" && promoted?.status === "PENDING", `Waitlist promotion failed: ${JSON.stringify(after.map(({ email, status }) => ({ email, status })))}`);
  html = await detail(second.id);
  const approveForm = approveFormIn(html);
  ensure(approveForm, "Approve form missing");
  response = await submit(organizerUrl, approveForm, {}, cookie);
  ensure(response.status === 303, "Approval failed");
  const approved = await db.registrant.findUniqueOrThrow({ where: { id: second.id } });
  ensure(approved.status === "APPROVED" && approved.qrCode, "Approval did not issue QR");
  const qrResponse = await fetch(`${base}/organizer/${eventId}/registrants/${approved.id}/qr`, { headers: { cookie } });
  ensure(qrResponse.status === 200 && qrResponse.headers.get("content-type") === "image/png" && (await qrResponse.arrayBuffer()).byteLength > 100, "Organizer QR download failed");
  const wrongDayUrl = `${base}/check-in/${eventId}?session=${otherSession.id}`;
  html = await (await fetch(wrongDayUrl, { headers: { cookie } })).text();
  const scanForm = formsFrom(html).find((form) => form.includes('name="code"') && form.includes("$ACTION_"));
  ensure(scanForm, "QR scanner fallback form missing");
  response = await submit(wrongDayUrl, scanForm, { code: approved.qrCode }, cookie);
  ensure(response.status === 303 && response.headers.get("location")?.includes("result=wrong-day") && await db.checkIn.count({ where: { sessionId: otherSession.id } }) === 0, "Wrong-day QR was not rejected");

  let staffResponse = await fetch(`${base}/api/auth/csrf`);
  const staffCsrf = (await staffResponse.json()).csrfToken;
  let staffCookie = staffResponse.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  staffResponse = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", headers: { cookie: staffCookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: staffCsrf, email: staffEmail, password: staffPassword, callbackUrl: `${base}/check-in` }), redirect: "manual" });
  ensure(staffResponse.status === 302, "Check-in staff login failed");
  staffCookie += `; ${staffResponse.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;
  const staffPreview = await (await fetch(`${base}/check-in/${eventId}?session=${session.id}&q=Person%202`, { headers: { cookie: staffCookie } })).text();
  ensure(staffPreview.includes("Person 2") && !staffPreview.includes(`PRIVATE-${suffix}`), "Check-in preview exposed a sensitive answer or hid an approved field");
  for (const [path, expected] of [[`/check-in/${eventId}`, 200], [`/organizer/${eventId}`, 404], [`/organizer/${eventId}/registrants`, 404], [`/organizer/${eventId}/dashboard`, 404], [`/organizer/${eventId}/registrants/${approved.id}/qr`, 404], [`/organizer/${eventId}/registrants/${first.id}/files/proof`, 404]]) {
    const checked = await fetch(`${base}${path}`, { headers: { cookie: staffCookie }, redirect: "manual" });
    ensure(checked.status === expected, `CHECKIN_ONLY access mismatch for ${path}: ${checked.status}`);
  }
  await db.user.update({ where: { id: staff.id }, data: { isActive: false } });
  const inactiveAccess = await fetch(`${base}/check-in/${eventId}`, { headers: { cookie: staffCookie }, redirect: "manual" });
  ensure([302, 303, 307, 308].includes(inactiveAccess.status) && inactiveAccess.headers.get("location")?.includes("/login"), "Deactivated staff session still reached check-in");

  let fullResponse = await fetch(`${base}/api/auth/csrf`);
  const fullCsrf = (await fullResponse.json()).csrfToken;
  let fullCookie = fullResponse.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  fullResponse = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", headers: { cookie: fullCookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: fullCsrf, email: fullEmail, password: fullPassword, callbackUrl: `${base}/organizer` }), redirect: "manual" });
  ensure(fullResponse.status === 302, "FULL organizer login failed");
  fullCookie += `; ${fullResponse.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;
  for (const path of [`/organizer/${eventId}`, `/organizer/${eventId}/registrants`, `/organizer/${eventId}/dashboard`, `/organizer/${eventId}/registrants/export`, `/organizer/${eventId}/registrants/${approved.id}/qr`, `/check-in/${eventId}`]) {
    const checked = await fetch(`${base}${path}`, { headers: { cookie: fullCookie }, redirect: "manual" });
    ensure(checked.status === 200, `FULL organizer denied ${path}: ${checked.status}`);
  }

  const checkInUrl = `${base}/check-in/${eventId}?session=${session.id}&q=${encodeURIComponent(second.email)}`;
  html = await (await fetch(checkInUrl, { headers: { cookie } })).text();
  const checkInForm = formsFrom(html).find((form) => form.includes("เช็คชื่อ</button>") && form.includes("$ACTION_") && !form.includes('name="code"'));
  ensure(checkInForm, "Manual check-in form missing");
  response = await submit(checkInUrl, checkInForm, {}, cookie);
  const checkInCount = await db.checkIn.count({ where: { sessionId: session.id, registrantId: approved.id } });
  ensure(response.status === 303 && checkInCount === 1, `Manual check-in failed: status=${response.status} location=${response.headers.get("location")} count=${checkInCount}`);
  response = await submit(checkInUrl, checkInForm, {}, cookie);
  ensure(response.status === 303 && response.headers.get("location")?.includes("result=duplicate"), "Duplicate check-in not blocked");
  html = await (await fetch(checkInUrl, { headers: { cookie } })).text();
  const undoForm = formsFrom(html).find((form) => form.includes("ยกเลิก"));
  ensure(undoForm, "Undo form missing");
  response = await submit(checkInUrl, undoForm, {}, cookie);
  ensure(response.status === 200 && await db.checkIn.count({ where: { sessionId: session.id, registrantId: approved.id, voidedAt: null } }) === 0 && await db.checkIn.count({ where: { sessionId: session.id, registrantId: approved.id } }) === 1, "Undo check-in was not a soft delete");
  html = await (await fetch(checkInUrl, { headers: { cookie } })).text();
  const correctScanForm = formsFrom(html).find((form) => form.includes('name="code"') && form.includes("$ACTION_"));
  ensure(correctScanForm, "Scanner form for concurrent check-in missing");
  const parallelScans = await Promise.all([submit(checkInUrl, correctScanForm, { code: approved.qrCode }, cookie), submit(checkInUrl, correctScanForm, { code: approved.qrCode }, cookie)]);
  const scanResults = parallelScans.map((item) => new URL(item.headers.get("location"), base).searchParams.get("result")).sort();
  ensure(parallelScans.every((item) => item.status === 303) && scanResults.join(",") === "duplicate,success" && await db.checkIn.count({ where: { sessionId: session.id, registrantId: approved.id, voidedAt: null } }) === 1, `Concurrent check-in race: ${parallelScans.map((item) => `${item.status}:${item.headers.get("location")}`).join(", ")}`);

  const manualUrl = `${base}/organizer/${eventId}/registrants/new`;
  html = await (await fetch(manualUrl, { headers: { cookie } })).text();
  const manualForm = formsFrom(html).find((form) => form.includes('name="approveNow"'));
  ensure(manualForm, "Manual registration form missing");
  response = await submit(manualUrl, manualForm, { email: `manual-${suffix}@example.invalid`, dayId: day.id, "answer:name": "Manual Person", consent: "on", approveNow: "on" }, cookie);
  ensure(response.status === 303 && response.headers.get("location")?.includes("/status/"), "Manual registration failed");
  const manual = await db.registrant.findFirstOrThrow({ where: { eventId, email: `manual-${suffix}@example.invalid` } });
  ensure(manual.status === "WAITLISTED" && !!manual.consentedAt && await db.auditLog.count({ where: { eventId, action: "MANUAL_REGISTRATION_CREATED", target: manual.id } }) === 1, "Manual registration did not respect capacity or audit consent");
  // Walk-ins without email are allowed (QR printed by the organizer) and have no dedupe key.
  const walkInsBefore = await db.registrant.count({ where: { eventId, email: null } });
  response = await submit(manualUrl, manualForm, { email: "", dayId: day.id, "answer:name": `No email ${suffix}`, consent: "on" }, cookie);
  ensure(response.status === 303 && response.headers.get("location")?.includes("/status/") && await db.registrant.count({ where: { eventId, email: null, dedupeKey: null } }) === walkInsBefore + 1, "Walk-in without email failed");

  response = await submit(publicUrl, registrationForm, { email: `mixed-${suffix}@example.invalid`, dayId: [day.id, otherDay.id], "answer:name": "Mixed days", consent: "on" });
  ensure(response.status === 303, "Mixed-day registration failed");
  const mixed = await db.registrant.findFirstOrThrow({ where: { eventId, email: `mixed-${suffix}@example.invalid` }, include: { days: true } });
  ensure(mixed.status === "PENDING" && mixed.days.find((item) => item.eventDayId === day.id)?.status === "WAITLISTED" && mixed.days.find((item) => item.eventDayId === otherDay.id)?.status === "PENDING", "Mixed-day capacity did not stay independent");
  html = await detail(mixed.id);
  const mixedDayApprovals = formsFrom(html).filter((form) => form.includes("อนุมัติวันนี้"));
  ensure(mixedDayApprovals.length === 2, "Per-day approval controls missing");
  response = await submit(organizerUrl, mixedDayApprovals[1], {}, cookie);
  ensure(response.status === 303, "Per-day approval failed");
  const mixedApproved = await db.registrant.findUniqueOrThrow({ where: { id: mixed.id }, include: { days: true } });
  ensure(mixedApproved.status === "APPROVED" && !!mixedApproved.qrCode && mixedApproved.days.find((item) => item.eventDayId === day.id)?.status === "WAITLISTED" && mixedApproved.days.find((item) => item.eventDayId === otherDay.id)?.status === "APPROVED", "Per-day approval changed the wrong day");
  html = await (await fetch(`${base}/check-in/${eventId}?session=${session.id}`, { headers: { cookie } })).text();
  const mixedScanForm = formsFrom(html).find((form) => form.includes('name="code"') && form.includes("$ACTION_"));
  response = await submit(`${base}/check-in/${eventId}?session=${session.id}`, mixedScanForm, { code: mixedApproved.qrCode }, cookie);
  ensure(response.headers.get("location")?.includes("result=wrong-day"), "QR accepted for a waitlisted day");
  await db.eventDay.update({ where: { id: otherDay.id }, data: { isClosed: true } });
  const closedDayHtml = await (await fetch(publicUrl)).text();
  ensure(closedDayHtml.includes("ปิดรับลงทะเบียนวันนี้"), "Closed day was not shown as unavailable");
  response = await submit(publicUrl, registrationForm, { email: `closed-${suffix}@example.invalid`, dayId: otherDay.id, "answer:name": "Closed day", consent: "on" });
  ensure(response.status === 303 && response.headers.get("location")?.includes("error=not-open") && await db.registrant.count({ where: { eventId, email: `closed-${suffix}@example.invalid` } }) === 0, "Closed day accepted a registration");

  html = await detail(second.id);
  const reissueForm = formsFrom(html).find((form) => form.includes("ออกลิงก์สถานะใหม่"));
  ensure(reissueForm, "Reissue form missing");
  response = await submit(organizerUrl, reissueForm, { confirm: "on" }, cookie);
  ensure(response.status === 303 && response.headers.get("location")?.includes("/status/"), "Reissuing status link failed");
  const oldStatus = await fetch(new URL(statusUrls[1], base));
  const newStatus = await fetch(new URL(response.headers.get("location"), base));
  ensure(oldStatus.status === 404 && newStatus.status === 200, "Old status link was not invalidated or new link failed");
  const dashboard = await fetch(`${base}/organizer/${eventId}/dashboard`, { headers: { cookie } });
  ensure(dashboard.status === 200 && (await dashboard.text()).includes("ภาพรวมการลงทะเบียนและเช็คชื่อ"), "Dashboard did not render");
  // Form builder after publishing with registrants (spec 1.4): edits are allowed and audited; changes that would
  // orphan stored answers need an explicit confirmation; answers are never deleted.
  const settingsUrl = `${base}/organizer/${eventId}`;
  const fieldPanel = async (key) => formsFrom(await (await fetch(`${settingsUrl}?step=3&field=${encodeURIComponent(key)}`, { headers: { cookie } })).text())
    .find((form) => form.includes('name="label"') && (form.includes("เพิ่มฟิลด์</button>") || form.includes("บันทึกฟิลด์</button>")));
  const clickPanelButton = (formHtml, ariaLabelPart, values = {}) => {
    const button = [...formHtml.matchAll(/<button[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(`aria-label="${ariaLabelPart}`));
    const name = button?.match(/name="([^"]+)"/)?.[1];
    ensure(name, `Button ${ariaLabelPart} missing`);
    return submit(settingsUrl, formHtml, { ...values, [name]: "" }, cookie);
  };
  const eventFields = async () => (await db.event.findUniqueOrThrow({ where: { id: eventId }, select: { fields: true, fieldsVersion: true } }));
  const versionBefore = (await eventFields()).fieldsVersion;
  const step3 = await (await fetch(`${settingsUrl}?step=3`, { headers: { cookie } })).text();
  ensure(step3.includes(`เวอร์ชันฟอร์ม v${versionBefore}`) && step3.includes("หน้างาน") && !step3.includes("แก้ฟอร์มได้เฉพาะ"), "Step 3 did not show the form version / check-in badge or is still locked");
  response = await submit(settingsUrl, await fieldPanel("__new__"), { label: "ประเภทผู้เข้าร่วม", type: "select", optionsText: "ข้าราชการ\nเอกชน" }, cookie);
  ensure(response.status === 303 && !response.headers.get("location")?.includes("error="), `Adding a field after registrations failed: ${response.headers.get("location")}`);
  const typeKey = (await eventFields()).fields.at(-1).key;
  const changedAudit = () => db.auditLog.findMany({ where: { eventId, action: "EVENT_FIELDS_CHANGED" }, orderBy: { createdAt: "asc" } });
  let audits = await changedAudit();
  ensure(audits.length === 1 && audits[0].metadata?.fieldKey === typeKey && audits[0].metadata?.change === "added" && audits[0].target === typeKey, "Field added after publishing was not audited");
  // Simulate an answer given under the current form.
  await db.registrant.update({ where: { id: second.id }, data: { answers: { ...(await db.registrant.findUniqueOrThrow({ where: { id: second.id } })).answers, [typeKey]: "เอกชน" } } });
  response = await submit(settingsUrl, await fieldPanel(typeKey), { label: "ประเภท (แก้ชื่อ)", optionsText: "ข้าราชการ\nเอกชน" }, cookie);
  ensure(response.status === 303 && !response.headers.get("location")?.includes("error=") && (await eventFields()).fields.find((field) => field.key === typeKey)?.label === "ประเภท (แก้ชื่อ)", "Relabelling a field with answers was refused");
  let panel = await fieldPanel(typeKey);
  ensure(panel.includes("ตอบฟิลด์นี้ไปแล้ว") && panel.includes('name="confirmAnswers"'), "Answered-count warning / confirmation missing from the edit panel");
  response = await submit(settingsUrl, panel, { label: "ประเภท (แก้ชื่อ)", optionsText: "ข้าราชการ\nบุคคลทั่วไป" }, cookie);
  ensure(response.headers.get("location")?.includes("error=confirm-required") && (await eventFields()).fields.find((field) => field.key === typeKey)?.options.includes("เอกชน"), "Removing an answered option without confirmation was accepted");
  response = await submit(settingsUrl, panel, { label: "ประเภท (แก้ชื่อ)", optionsText: "ข้าราชการ\nบุคคลทั่วไป", confirmAnswers: "on" }, cookie);
  ensure(response.status === 303 && !response.headers.get("location")?.includes("error="), `Confirmed option change failed: ${response.headers.get("location")}`);
  ensure((await eventFields()).fields.find((field) => field.key === typeKey)?.options.join(",") === "ข้าราชการ,บุคคลทั่วไป", "Confirmed option change was not saved");
  ensure((await db.registrant.findUniqueOrThrow({ where: { id: second.id } })).answers[typeKey] === "เอกชน", "Stored answer was changed by an option edit");
  audits = await changedAudit();
  const optionAudit = audits.at(-1);
  ensure(optionAudit.metadata?.change === "updated" && optionAudit.metadata?.optionsRemoved === 1 && !JSON.stringify(optionAudit.metadata).includes("เอกชน"), "Option change audit is missing or leaks values");
  response = await submit(settingsUrl, await fieldPanel("__new__"), { label: "สังกัดราชการ", type: "text", conditionField: typeKey, conditionValues: ["ข้าราชการ"] }, cookie);
  ensure(!response.headers.get("location")?.includes("error="), `Child field was not added: ${response.headers.get("location")}`);
  const childKey = (await eventFields()).fields.at(-1).key;
  response = await clickPanelButton(await fieldPanel(typeKey), "ลบฟิลด์", { confirmAnswers: "on" });
  ensure(response.headers.get("location")?.includes("error=field-has-children") && (await eventFields()).fields.some((field) => field.key === typeKey), "A parent field was deleted while a child depended on it");
  response = await clickPanelButton(await fieldPanel(childKey), "ลบฟิลด์");
  ensure(response.status === 303 && !response.headers.get("location")?.includes("error=") && !(await eventFields()).fields.some((field) => field.key === childKey), "Deleting an unanswered child field failed");
  response = await clickPanelButton(await fieldPanel(typeKey), "ลบฟิลด์");
  ensure(response.headers.get("location")?.includes("error=confirm-required") && (await eventFields()).fields.some((field) => field.key === typeKey), "Deleting an answered field without confirmation was accepted");
  response = await clickPanelButton(await fieldPanel(typeKey), "ลบฟิลด์", { confirmAnswers: "on" });
  ensure(response.status === 303 && !(await eventFields()).fields.some((field) => field.key === typeKey), "Confirmed delete of an answered field failed");
  ensure((await db.registrant.findUniqueOrThrow({ where: { id: second.id } })).answers[typeKey] === "เอกชน", "Deleting a field removed stored answers");
  audits = await changedAudit();
  ensure(audits.length === 6 && audits.at(-1).metadata?.change === "removed" && audits.at(-1).metadata?.answersKept === true, `Field removal audit missing (${audits.length})`);
  ensure((await eventFields()).fieldsVersion === versionBefore + 6, "fieldsVersion was not bumped on every schema change");
  const orphanDetail = await fetch(`${organizerUrl}?selected=${second.id}`, { headers: { cookie } });
  ensure(orphanDetail.status === 200 && (await orphanDetail.text()).includes("คำตอบจากฟิลด์ที่ลบแล้ว"), "Registrant detail did not handle an orphan answer");
  const orphanCsv = await fetch(`${organizerUrl}/export`, { headers: { cookie } });
  ensure(orphanCsv.status === 200 && !(await orphanCsv.text()).includes("เอกชน"), "Export failed or leaked an orphan answer");
  ensure((await fetch(`${base}/check-in/${eventId}?session=${session.id}&q=Person%202`, { headers: { cookie } })).status === 200, "Check-in page failed after form changes");

  // Multi-file field (up to 3) accepting pdf + docx; the older proof field accepts pdf only.
  response = await submit(settingsUrl, await fieldPanel("__new__"), { label: "เอกสารแนบ", type: "file", acceptedFileTypes: ["pdf", "docx"], maxFileSizeMb: "1", maxFiles: "3" }, cookie);
  ensure(!response.headers.get("location")?.includes("error="), `Multi-file field was not added: ${response.headers.get("location")}`);
  const docsField = (await eventFields()).fields.at(-1);
  ensure(docsField.type === "file" && docsField.maxFiles === 3 && docsField.acceptedFileTypes.join(",") === "pdf,docx", "Multi-file settings were not saved");
  const docx = () => new File([Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]), Buffer.from("[Content_Types].xml ... word/document.xml ... PK")])], "letter.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const pdf = (name) => new File([`%PDF-1.7\n${name}\n`], name, { type: "application/pdf" });
  const fileIp = `smoke-files-${randomUUID()}`;
  const register = async (values) => {
    const page = await (await fetch(publicUrl)).text();
    const form = formsFrom(page).find((item) => item.includes('name="consent"'));
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const body = formDataFrom(form, { dayId: day.id, consent: "on", "answer:name": "File person" });
    for (const [name, value] of Object.entries(values)) {
      if (Array.isArray(value)) { body.delete(name); for (const item of value) body.append(name, item); } else body.set(name, value);
    }
    return fetch(publicUrl, { method: "POST", headers: { origin: base, "x-forwarded-for": fileIp }, body, redirect: "manual" });
  };
  response = await register({ email: `files-${suffix}@example.invalid`, [`answer:${docsField.key}`]: [pdf("one.pdf"), docx()] });
  ensure(response.status === 303 && response.headers.get("location")?.includes("/status/"), `Multi-file registration failed: ${response.headers.get("location")}`);
  const fileStatusUrl = new URL(response.headers.get("location"), base);
  const filePerson = await db.registrant.findFirstOrThrow({ where: { eventId, email: `files-${suffix}@example.invalid` } });
  const docs = filePerson.answers[docsField.key];
  ensure(Array.isArray(docs) && docs.length === 2 && docs[0].originalName === "one.pdf" && docs[1].contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && docs[1].storageKey.endsWith(".docx"), "Multi-file answer was not stored as an array");
  uploadedKeys.push(...docs.map((file) => file.storageKey));
  const firstDoc = await fetch(`${organizerUrl}/${filePerson.id}/files/${docsField.key}`, { headers: { cookie } });
  const secondDoc = await fetch(`${organizerUrl}/${filePerson.id}/files/${docsField.key}?i=1`, { headers: { cookie } });
  ensure(firstDoc.status === 200 && (await firstDoc.text()).startsWith("%PDF-") && secondDoc.status === 200 && secondDoc.headers.get("content-type")?.includes("wordprocessingml") && (await secondDoc.arrayBuffer()).byteLength > 8, "Multi-file downloads failed");
  ensure((await fetch(`${organizerUrl}/${filePerson.id}/files/${docsField.key}?i=2`, { headers: { cookie } })).status === 404, "Out-of-range file index did not 404");
  const fileDetail = await (await fetch(`${organizerUrl}?selected=${filePerson.id}`, { headers: { cookie } })).text();
  ensure(fileDetail.includes("one.pdf") && fileDetail.includes("letter.docx") && fileDetail.includes(`files/${docsField.key}?i=1`), "Registrant detail did not list every attachment");
  const fileCsv = await (await fetch(`${organizerUrl}/export`, { headers: { cookie } })).text();
  ensure(fileCsv.includes("one.pdf, letter.docx"), "Export did not list every attachment");
  // Self-edit keeps multi-file answers and answers of removed fields (orphan keys) untouched.
  await db.registrant.update({ where: { id: filePerson.id }, data: { answers: { ...filePerson.answers, [typeKey]: "เอกชน" } } });
  const editUrl = `${fileStatusUrl.href}/edit`;
  const editForm = formsFrom(await (await fetch(editUrl)).text()).find((form) => form.includes('name="answer:name"'));
  ensure(editForm, "Self-edit form missing");
  response = await fetch(editUrl, { method: "POST", headers: { origin: base, "x-forwarded-for": fileIp }, body: formDataFrom(editForm, { "answer:name": "File person edited" }), redirect: "manual" });
  const edited = (await db.registrant.findUniqueOrThrow({ where: { id: filePerson.id } })).answers;
  ensure(response.status === 303 && edited.name === "File person edited" && edited[typeKey] === "เอกชน" && edited[docsField.key]?.length === 2, `Self-edit dropped orphan or file answers: ${response.status} ${response.headers.get("location")}`);
  response = await register({ email: `docx-${suffix}@example.invalid`, "answer:proof": docx() });
  ensure(response.headers.get("location")?.includes("error=invalid") && await db.registrant.count({ where: { eventId, email: `docx-${suffix}@example.invalid` } }) === 0, "docx was accepted by a pdf-only field");
  response = await register({ email: `many-${suffix}@example.invalid`, [`answer:${docsField.key}`]: [pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf"), pdf("d.pdf")] });
  ensure(response.headers.get("location")?.includes("error=invalid") && await db.registrant.count({ where: { eventId, email: `many-${suffix}@example.invalid` } }) === 0, "More files than maxFiles were accepted");
  process.stdout.write("Registration, waitlist, wrong-day/concurrent check-in, undo, link rotation, role access, form edits after registration and multi-file uploads passed.\n");
} finally {
  if (eventId) {
    await db.auditLog.deleteMany({ where: { eventId } });
    await db.event.delete({ where: { id: eventId } });
  }
  for (const key of uploadedKeys) { try { await unlink(join(process.cwd(), ".local-uploads", key)); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  if (staffId || fullId) await db.auditLog.deleteMany({ where: { actorId: { in: [staffId, fullId].filter(Boolean) } } });
  if (staffId) await db.user.delete({ where: { id: staffId } });
  if (fullId) await db.user.delete({ where: { id: fullId } });
  await db.$disconnect();
}
