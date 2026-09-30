import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import nextEnv from "@next/env";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = "http://localhost:3100";
let eventId;
let staffId;

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

async function login(email, password) {
  let response = await fetch(`${base}/api/auth/csrf`);
  const csrfToken = (await response.json()).csrfToken;
  const cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  response = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${base}/organizer` }), redirect: "manual" });
  ensure(response.status === 302 && !location(response).includes("error="), `Login failed for ${email}`);
  return `${cookie}; ${response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;
}

/** Calls a server action that the UI invokes from client code, using the dev server's action manifest. */
async function callAction(pagePath, name, args, cookie) {
  const manifest = JSON.parse(readFileSync(".next/dev/server/app/(check-in)/check-in/[eventId]/page/server-reference-manifest.json", "utf8"));
  const id = Object.entries(manifest.node).find(([, value]) => value.exportedName === name)?.[0];
  ensure(id, `Action ${name} not found in manifest`);
  const response = await fetch(`${base}${pagePath}`, { method: "POST", headers: { cookie, origin: base, "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, body: JSON.stringify(args) });
  return response.text();
}

// The captcha checks need the admin Turnstile switch on; restore whatever an admin had set when finished.
const savedTurnstile = await db.systemSetting.findUnique({ where: { key: "turnstile" } });
await db.systemSetting.deleteMany({ where: { key: "turnstile" } });
try {
  const suffix = randomUUID();
  const owner = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" }, select: { id: true } });
  const event = await db.event.create({ data: {
    slug: `rules-smoke-${suffix}`, title: "Rules smoke", ownerId: owner.id, status: "PUBLISHED", autoApprove: false,
    registrationDeadline: new Date("2031-12-31T16:59:59.999Z"),
    fields: [{ key: "name", label: "ชื่อ", type: "text", required: true, showOnCheckin: true }],
    days: { create: [{ date: new Date("2031-11-01T00:00:00.000Z"), maxSeats: 1 }, { date: new Date("2031-11-02T00:00:00.000Z"), maxSeats: 5 }] },
  } });
  eventId = event.id;
  const [dayOne, dayTwo] = await db.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" } });
  const morningOne = await db.session.create({ data: { eventId, eventDayId: dayOne.id, label: "เช้า" } });
  await db.session.create({ data: { eventId, eventDayId: dayTwo.id, label: "เช้า" } });
  const publicUrl = `${base}/events/${event.slug}`;
  const cookie = await login("admin@checkinhub.local", "CheckInHub123!");

  // Bot defences: submitting straight away and filling the honeypot are both refused.
  let html = await (await fetch(publicUrl)).text();
  const form = formsFrom(html).find((part) => part.includes('name="consent"'));
  ensure(form?.includes('name="formTicket"') && form.includes('name="website"'), "Public form is missing the ticket or honeypot");
  const values = (email) => ({ email, dayId: dayOne.id, "answer:name": email.split("@")[0], consent: "on" });
  let response = await post(publicUrl, form, values(`fast-${suffix}@example.invalid`), { "x-forwarded-for": `rules-fast-${suffix}` });
  ensure(location(response).includes("error=too-fast"), `Instant submission was accepted: ${location(response)}`);
  await wait(3100);
  response = await post(publicUrl, form, { ...values(`bot-${suffix}@example.invalid`), website: "https://spam.example" }, { "x-forwarded-for": `rules-bot-${suffix}` });
  ensure(location(response).includes("error=invalid"), "Honeypot submission was accepted");
  response = await post(publicUrl, form, { ...values(`forged-${suffix}@example.invalid`), formTicket: `${Date.now() - 10_000}.forged` }, { "x-forwarded-for": `rules-forged-${suffix}` });
  ensure(location(response).includes("error=invalid"), "Forged form ticket was accepted");
  if (process.env.TURNSTILE_SECRET_KEY) {
    // With Turnstile configured, a submission without (or with a bad) token is refused.
    response = await post(publicUrl, form, { ...values(`nocaptcha-${suffix}@example.invalid`), "cf-turnstile-response": "" }, { "x-forwarded-for": `rules-captcha-${suffix}` });
    ensure(location(response).includes("error=captcha"), `Submission without a Turnstile token was accepted: ${location(response)}`);
  }
  ensure(await db.registrant.count({ where: { eventId } }) === 0, "A refused submission created a registrant");

  // Consent evidence is stored with the registration.
  response = await post(publicUrl, form, { ...values(`alice-${suffix}@example.invalid`), dayId: [dayOne.id, dayTwo.id] }, { "x-forwarded-for": `rules-alice-${suffix}` });
  ensure(location(response).includes("/status/"), `Registration failed: ${location(response)}`);
  const alice = await db.registrant.findFirstOrThrow({ where: { eventId, email: `alice-${suffix}@example.invalid` } });
  ensure(alice.consentVersion === "v1" && alice.consentIp === `rules-alice-${suffix}` && alice.consentedAt && alice.fieldsVersion === event.fieldsVersion, "Consent evidence or form version was not stored");

  // Approve Alice for day two only; day one stays pending, so a day-one scan is a wrong-day case.
  await db.registrantEventDay.updateMany({ where: { registrantId: alice.id, eventDayId: dayTwo.id }, data: { status: "APPROVED", pendingSince: null } });
  await db.registrant.update({ where: { id: alice.id }, data: { status: "APPROVED", qrCode: `rules-qr-${suffix}`, approvedAt: new Date() } });
  const checkInPath = `/check-in/${eventId}?session=${morningOne.id}`;
  html = await (await fetch(`${base}${checkInPath}`, { headers: { cookie } })).text();
  const scanForm = formsFrom(html).find((part) => part.includes('name="code"') && part.includes("$ACTION_"));
  response = await post(`${base}${checkInPath}`, scanForm, { code: `rules-qr-${suffix}` }, { cookie });
  ensure(location(response).includes("result=wrong-day"), "Day-one scan for a day-two approval was not flagged");

  // A check-in-only collaborator may not override; the owner may, with a reason, and it is audited.
  const staffEmail = `rules-staff-${suffix}@example.invalid`;
  const staff = await db.user.create({ data: { name: "Rules staff", email: staffEmail, passwordHash: await hash("Rules-Staff-Password-1", 12), role: "ORGANIZER" } });
  staffId = staff.id;
  await db.eventOrganizer.create({ data: { eventId, userId: staff.id, role: "CHECKIN_ONLY" } });
  const staffCookie = await login(staffEmail, "Rules-Staff-Password-1");
  await callAction(checkInPath, "overrideCheckIn", [eventId, morningOne.id, `rules-qr-${suffix}`, "ผู้บริหารขอเข้าร่วม"], staffCookie);
  ensure(await db.checkIn.count({ where: { sessionId: morningOne.id } }) === 0, "Check-in-only staff overrode a wrong-day scan");
  await callAction(checkInPath, "overrideCheckIn", [eventId, morningOne.id, `rules-qr-${suffix}`, ""], cookie);
  ensure(await db.checkIn.count({ where: { sessionId: morningOne.id } }) === 0, "Override without a reason was accepted");
  await callAction(checkInPath, "overrideCheckIn", [eventId, morningOne.id, `rules-qr-${suffix}`, "ผู้บริหารขอเข้าร่วม"], cookie);
  const override = await db.checkIn.findFirst({ where: { sessionId: morningOne.id, registrantId: alice.id, voidedAt: null } });
  ensure(override?.isOverride && override.overrideNote === "ผู้บริหารขอเข้าร่วม", "Owner override was not recorded");
  ensure(await db.auditLog.count({ where: { eventId, action: "CHECKIN_OVERRIDE", target: override.id } }) === 1, "Override was not audited");

  // Session labels: same label on different days is fine; an every-day session may not reuse it.
  const eventPage = `${base}/organizer/${eventId}?step=4`;
  html = await (await fetch(`${eventPage}&session=new`, { headers: { cookie } })).text();
  const addScopeForm = formsFrom(html).find((part) => part.includes('name="scope"'));
  response = await post(eventPage, addScopeForm, { label: "เช้า", scope: "EVENT" }, { cookie });
  ensure(location(response).includes("error=duplicate-session"), "Every-day session reused a day session label");
  response = await post(eventPage, addScopeForm, { label: "บ่าย", scope: "EACH_DAY" }, { cookie });
  ensure(location(response).includes("saved=session") && await db.session.count({ where: { eventId, label: "บ่าย" } }) === 2, "Per-day sessions with the same label could not be created");
  response = await post(eventPage, addScopeForm, { label: "เย็น", scope: dayOne.id, start: "17:00", end: "16:00" }, { cookie });
  ensure(location(response).includes("error=invalid-session-time"), "End time before start time was accepted");
  response = await post(eventPage, addScopeForm, { label: "เย็น", scope: dayOne.id, start: "16:00", end: "17:30" }, { cookie });
  const evening = await db.session.findFirst({ where: { eventId, label: "เย็น" } });
  ensure(evening?.startTime?.toISOString() === "2031-11-01T09:00:00.000Z" && evening.endTime?.toISOString() === "2031-11-01T10:30:00.000Z", `Session times not stored as Bangkok clock time: ${evening?.startTime?.toISOString()}`);

  // Removing a session with check-ins needs explicit confirmation, then deletes and audits.
  html = await (await fetch(`${eventPage}&session=${morningOne.id}`, { headers: { cookie } })).text();
  const removeForm = formsFrom(html).find((part) => part.includes('name="confirmCheckIns"'));
  ensure(removeForm, "Confirmation form for removing a used session missing");
  response = await post(eventPage, removeForm, {}, { cookie });
  ensure(location(response).includes("error=session-in-use") && await db.session.findUnique({ where: { id: morningOne.id } }), "Used session was removed without confirmation");
  response = await post(eventPage, removeForm, { confirmCheckIns: "on" }, { cookie });
  ensure(!(await db.session.findUnique({ where: { id: morningOne.id } })) && await db.auditLog.count({ where: { eventId, action: "EVENT_SESSION_REMOVED_WITH_CHECKINS", target: morningOne.id } }) === 1, "Confirmed removal did not delete and audit the session");

  // Manual add: day one is full (Alice is pending), so approval needs the audited override.
  const manualUrl = `${base}/organizer/${eventId}/registrants/new`;
  html = await (await fetch(manualUrl, { headers: { cookie } })).text();
  const manualForm = formsFrom(html).find((part) => part.includes('name="overrideCapacity"'));
  ensure(manualForm, "Manual add form lacks the capacity override option");
  await post(manualUrl, manualForm, { email: `walkin-${suffix}@example.invalid`, dayId: dayOne.id, "answer:name": "Walk in", consent: "on", approveNow: "on" }, { cookie });
  ensure((await db.registrant.findFirstOrThrow({ where: { eventId, email: `walkin-${suffix}@example.invalid` } })).status === "WAITLISTED", "Manual add ignored capacity without override");
  await post(manualUrl, manualForm, { email: `vip-${suffix}@example.invalid`, dayId: dayOne.id, "answer:name": "VIP", consent: "on", approveNow: "on", overrideCapacity: "on" }, { cookie });
  const vip = await db.registrant.findFirstOrThrow({ where: { eventId, email: `vip-${suffix}@example.invalid` } });
  const vipAudit = await db.auditLog.findFirst({ where: { eventId, action: "MANUAL_REGISTRATION_CREATED", target: vip.id } });
  ensure(vip.status === "APPROVED" && vipAudit?.metadata?.capacityOverride === true, "Capacity override was not applied or audited");

  // eventType change warning appears once people have registered.
  html = await (await fetch(`${base}/organizer/${eventId}?step=1`, { headers: { cookie } })).text();
  ensure(html.includes("การเปลี่ยนประเภทโครงการไม่กระทบผู้ที่ลงทะเบียนไปแล้ว"), "eventType change warning missing");

  process.stdout.write("Rules: bot checks, consent evidence, wrong-day override permissions/audit, session label and removal rules, manual capacity override and eventType warning passed.\n");
} finally {
  await db.systemSetting.deleteMany({ where: { key: "turnstile" } });
  if (savedTurnstile) await db.systemSetting.create({ data: savedTurnstile });
  if (eventId) await db.event.delete({ where: { id: eventId } });
  if (staffId) await db.user.deleteMany({ where: { id: staffId } });
  await db.$disconnect();
}
