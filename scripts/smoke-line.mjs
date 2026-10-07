// LINE notifications (PROGRESS.md §D): status links for LINE messages, the outbox queued on status changes, delivery
// failure shown to organizers, resend rate limit, admin switch, unlinking, and the login callback's guards.
// Uses a made-up LINE user ID, so LINE refuses every push: no real message is sent and no quota is used. The success
// path (real login + push) was checked by hand on 27 Sep 2026. Needs the LINE keys in .env.local.
import { createHash, createHmac, randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = "http://localhost:3100";
const eventIds = [];

function ensure(value, message) { if (!value) throw new Error(message); }
const hash = (token) => createHash("sha256").update(token).digest("hex");
const lineToken = (id, statusTokenHash) => `l.${id}.${createHmac("sha256", process.env.AUTH_SECRET).update(`line-status:${id}:${statusTokenHash}`).digest("base64url")}`;
const formsFrom = (html) => html.split("<form").slice(1).map((part) => `<form${part.split("</form>")[0]}</form>`);
function formDataFrom(html, values = {}) {
  const data = new FormData();
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) data.set(match[1], (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const post = (url, form, cookie = "") => fetch(url, { method: "POST", redirect: "manual", headers: { origin: base, ...(cookie ? { cookie } : {}) }, body: formDataFrom(form) });
const location = (response) => response.headers.get("location") ?? "";
async function waitFor(check, message, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
async function login(email) {
  let response = await fetch(`${base}/api/auth/csrf`);
  const csrfToken = (await response.json()).csrfToken;
  const cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  response = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken, email, password: "CheckInHub123!", callbackUrl: `${base}/organizer` }), redirect: "manual" });
  return `${cookie}; ${response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;
}

ensure(process.env.LINE_LOGIN_CHANNEL_ID && process.env.LINE_MESSAGING_ACCESS_TOKEN, "LINE keys missing in .env.local");
const savedSwitch = await db.systemSetting.findUnique({ where: { key: "lineLogin" } });
const startedAt = new Date();
try {
  await db.systemSetting.upsert({ where: { key: "lineLogin" }, create: { key: "lineLogin", enabled: true }, update: { enabled: true } });
  const suffix = randomUUID();
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" }, select: { id: true } });
  const event = await db.event.create({ data: {
    slug: `line-smoke-${suffix}`, title: "LINE smoke", ownerId: admin.id, status: "PUBLISHED", autoApprove: false, waitlistEnabled: true,
    registrationDeadline: new Date("2031-12-30T16:59:59.999Z"), fields: [{ key: "name", label: "ชื่อ", type: "text", required: true, showOnCheckin: true }],
    days: { create: [{ date: new Date("2031-12-01T00:00:00Z"), maxSeats: 10 }] },
  } });
  eventIds.push(event.id);
  const day = await db.eventDay.findFirstOrThrow({ where: { eventId: event.id } });
  const token = `line-smoke-${suffix}`;
  const makePerson = (label, lineUserId) => db.registrant.create({ data: {
    eventId: event.id, email: `${label}-${suffix}@example.invalid`, dedupeKey: `${label}-${suffix}@example.invalid`, status: "PENDING", consentedAt: new Date(),
    answers: { name: `LINE ${label}` }, displayName: `LINE ${label}`, statusTokenHash: hash(`${token}-${label}`), lineUserId, notifyVia: lineUserId ? "LINE" : "EMAIL",
    days: { create: [{ eventDayId: day.id, status: "PENDING", pendingSince: new Date() }] },
  } });
  // A well-formed but unknown LINE user: LINE refuses the push.
  const linked = await makePerson("linked", `U${"0".repeat(32)}`);
  const plain = await makePerson("plain", null);
  const statusUrl = (label) => `${base}/events/${event.slug}/status/${token}-${label}`;

  // Status page offers LINE to people who have not linked, and shows the linked state otherwise.
  let html = await (await fetch(statusUrl("plain"))).text();
  ensure(html.includes("เปลี่ยนเป็นรับทาง LINE") && formsFrom(html).some((form) => form.includes("เปลี่ยนเป็นรับทาง LINE")), "Connect-LINE button missing on the status page");
  html = await (await fetch(statusUrl("linked"))).text();
  ensure(html.includes("เปลี่ยนเป็นรับทางอีเมล"), "Linked state missing on the status page");

  // LINE status links: valid while the status link is unchanged; forged or rotated ones open nothing.
  const current = await db.registrant.findUniqueOrThrow({ where: { id: linked.id }, select: { statusTokenHash: true } });
  const viaLine = `${base}/events/${event.slug}/status/${lineToken(linked.id, current.statusTokenHash)}`;
  ensure((await fetch(viaLine)).status === 200 && (await (await fetch(viaLine)).text()).includes("LINE linked"), "LINE status link does not open the status page");
  ensure((await fetch(`${viaLine.slice(0, -3)}AAA`)).status === 404, "Forged LINE status link accepted");
  ensure((await fetch(`${base}/events/${event.slug}/status/${lineToken(plain.id, current.statusTokenHash)}`)).status === 404, "LINE link signed for another person accepted");

  // Approving queues a LINE message in the same transaction; delivery runs after the response and LINE refuses it.
  const cookie = await login("admin@checkinhub.local");
  const detailUrl = `${base}/organizer/${event.id}/registrants?selected=${linked.id}`;
  html = await (await fetch(detailUrl, { headers: { cookie } })).text();
  const approve = formsFrom(html).find((form) => />อนุมัติ<\/button>/.test(form));
  ensure(approve, "Approve form missing");
  let response = await post(`${base}/organizer/${event.id}/registrants`, approve, cookie);
  ensure(response.status === 303, `Approve failed: ${response.status}`);
  const failed = await waitFor(() => db.notificationLog.findFirst({ where: { registrantId: linked.id, status: "FAILED" } }), "undelivered LINE message marked FAILED");
  ensure(failed.kind === "status" && failed.channel === "LINE" && /^HTTP 4\d\d/.test(failed.error ?? "") && failed.attempts === 1, `Unexpected failure record: ${JSON.stringify(failed)}`);
  html = await (await fetch(detailUrl, { headers: { cookie } })).text();
  ensure(html.includes("LINE ส่งไม่ถึง") && html.includes("ส่งไม่ถึง") && html.includes("ส่งสถานะทาง LINE อีกครั้ง"), "Organizer does not see the failed LINE delivery");
  html = await (await fetch(statusUrl("linked"))).text();
  ensure(html.includes("ส่งข้อความล่าสุดไม่ถึง"), "Registrant is not told the LINE message did not arrive");
  // People without LINE get no LINE rows.
  const plainApprove = formsFrom(await (await fetch(`${base}/organizer/${event.id}/registrants?selected=${plain.id}`, { headers: { cookie } })).text()).find((form) => />อนุมัติ<\/button>/.test(form));
  await post(`${base}/organizer/${event.id}/registrants`, plainApprove, cookie);
  ensure(await db.notificationLog.count({ where: { registrantId: plain.id, channel: "LINE" } }) === 0, "LINE message queued for someone without LINE");

  // Resend: three per hour.
  for (let attempt = 1; attempt <= 4; attempt++) {
    html = await (await fetch(detailUrl, { headers: { cookie } })).text();
    const resend = formsFrom(html).find((form) => form.includes("ส่งสถานะทาง LINE อีกครั้ง"));
    response = await post(`${base}/organizer/${event.id}/registrants`, resend, cookie);
    ensure(location(response).includes(attempt <= 3 ? "result=line-resent" : "result=line-limit"), `Resend ${attempt}: ${location(response)}`);
  }
  await waitFor(async () => await db.notificationLog.count({ where: { registrantId: linked.id, kind: "resend", status: { in: ["QUEUED", "SENDING"] } } }) === 0, "resends processed");

  // Admin switch off: nothing is offered and queued messages are skipped, not sent.
  await db.systemSetting.update({ where: { key: "lineLogin" }, data: { enabled: false } });
  ensure(!(await (await fetch(statusUrl("plain"))).text()).includes("เปลี่ยนเป็นรับทาง LINE"), "Connect-LINE shown while switched off");
  html = await (await fetch(`${base}/organizer/${event.id}/registrants?selected=${linked.id}`, { headers: { cookie } })).text();
  const cancel = formsFrom(html).find((form) => form.includes("ยกเลิกการเข้าร่วม"));
  ensure(cancel, "Organizer cancel form missing");
  await post(`${base}/organizer/${event.id}/registrants`, cancel, cookie);
  const skipped = await waitFor(() => db.notificationLog.findFirst({ where: { registrantId: linked.id, channel: "LINE", status: "SKIPPED", createdAt: { gte: startedAt } } }), "message skipped while LINE is off");
  ensure(skipped.error?.includes("ปิดอยู่"), `Skipped for the wrong reason: ${skipped.error}`);
  await db.systemSetting.update({ where: { key: "lineLogin" }, data: { enabled: true } });

  // Unlinking from the status page clears the LINE ID.
  html = await (await fetch(statusUrl("linked"))).text();
  const unlink = formsFrom(html).find((form) => form.includes("เปลี่ยนเป็นรับทางอีเมล"));
  ensure(unlink, "Unlink form missing");
  response = await post(statusUrl("linked"), unlink);
  ensure(location(response).includes("line=unlinked"), `Unlink failed: ${location(response)}`);
  const after = await db.registrant.findUniqueOrThrow({ where: { id: linked.id }, select: { lineUserId: true, notifyVia: true } });
  ensure(after.lineUserId === null && after.notifyVia === "EMAIL", "Unlink did not clear LINE");

  // Starting the link goes to LINE Login with the add-friend prompt and sets the one-time state cookie.
  html = await (await fetch(statusUrl("plain"))).text();
  response = await post(statusUrl("plain"), formsFrom(html).find((form) => form.includes("เปลี่ยนเป็นรับทาง LINE")));
  ensure(response.status === 303 && location(response).startsWith("https://access.line.me/oauth2/v2.1/authorize?") && location(response).includes("bot_prompt=aggressive"), `Connect did not go to LINE Login: ${location(response)}`);
  const loginRedirect = response;
  const stateCookie = response.headers.getSetCookie().find((item) => item.startsWith("line-link="));
  ensure(stateCookie?.includes("HttpOnly") && stateCookie.includes("Path=/api/line"), "LINE state cookie missing or not httpOnly");
  // Callback guards: no cookie → expired page; wrong state → back with an error; forged cookie → expired.
  response = await fetch(`${base}/api/line/callback?code=x&state=y`, { redirect: "manual" });
  ensure(response.status === 400 && (await response.text()).includes("หมดอายุ"), "Callback without a state cookie not refused");
  response = await fetch(`${base}/api/line/callback?code=x&state=wrong`, { redirect: "manual", headers: { cookie: stateCookie.split(";")[0] } });
  ensure(response.status === 303 && location(response).includes("line=error"), `Callback with a wrong state not refused: ${location(response)}`);
  response = await fetch(`${base}/api/line/callback?code=x&state=y`, { redirect: "manual", headers: { cookie: `line-link=${Buffer.from("{}").toString("base64url")}.forged` } });
  ensure(response.status === 400, "Callback accepted a forged state cookie");
  // A valid `state` without the cookie (it is not secret: LINE and access logs see it) must not open the status page
  // unless LINE login succeeds: cancel/error answers get a plain page with no status link.
  const leakedState = new URL(location(loginRedirect)).searchParams.get("state");
  for (const query of [`error=access_denied&state=${leakedState}`, `state=${leakedState}`]) {
    response = await fetch(`${base}/api/line/callback?${query}`, { redirect: "manual" });
    const text = await response.text();
    ensure(response.status === 200 && !response.headers.get("location") && !text.includes("/status/"), `Cookie-less callback leaked the status link (${query}): ${response.status} ${response.headers.get("location")}`);
  }

  // Choosing LINE on the registration form: no email asked, stored as the channel, sent straight on to LINE Login.
  const publicUrl = `${base}/events/${event.slug}`;
  const registration = formsFrom(await (await fetch(publicUrl)).text()).find((form) => form.includes('name="consent"'));
  ensure(registration?.includes('name="notifyVia"') && registration.includes('value="LINE"'), "Registration form does not offer LINE as the channel");
  await new Promise((resolve) => setTimeout(resolve, 3100));
  const registrationBody = (email, channel) => {
    const data = formDataFrom(registration, { email: `${email}-${suffix}@example.invalid`, dayId: day.id, "answer:name": email, consent: "on", notifyVia: channel });
    data.set("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
    return data;
  };
  const registerAs = (email, channel, withEmail = true) => {
    const body = registrationBody(email, channel);
    if (!withEmail) body.delete("email");
    return fetch(publicUrl, { method: "POST", redirect: "manual", headers: { origin: base, "x-forwarded-for": `line-smoke-${suffix}` }, body });
  };
  response = await registerAs("chose-line", "LINE");
  ensure(response.status === 303 && location(response).startsWith("https://access.line.me/oauth2/v2.1/authorize?") && response.headers.getSetCookie().some((item) => item.startsWith("line-link=")), `Choosing LINE did not go to LINE Login: ${location(response)}`);
  const choseLine = await db.registrant.findFirstOrThrow({ where: { eventId: event.id, displayName: "chose-line" }, select: { id: true, notifyVia: true, lineUserId: true, email: true, dedupeKey: true } });
  // A stray email field (e.g. typed before switching to LINE) is ignored: LINE is the one channel.
  ensure(choseLine.notifyVia === "LINE" && choseLine.lineUserId === null && choseLine.email === null && choseLine.dedupeKey === null, "LINE choice was not stored without an email");
  response = await registerAs("line-only", "LINE", false);
  ensure(location(response).startsWith("https://access.line.me/"), `LINE registration without an email refused: ${location(response)}`);
  ensure(await db.notificationLog.count({ where: { registrantId: choseLine.id } }) === 0, "Something was queued for a LINE chooser before LINE is connected");
  response = await registerAs("no-email", "EMAIL", false);
  ensure(location(response).includes("error=invalid"), `Email channel accepted without an email: ${location(response)}`);
  response = await registerAs("chose-email", "EMAIL");
  ensure(response.status === 303 && location(response).includes("/status/"), `Choosing email did not open the status page: ${location(response)}`);
  ensure((await db.registrant.findFirstOrThrow({ where: { eventId: event.id, email: `chose-email-${suffix}@example.invalid` }, select: { notifyVia: true } })).notifyVia === "EMAIL", "Email choice was not stored");
  // Not connected yet: the status page says so and offers "use email instead", which switches the channel.
  const choseLineStatus = `${base}/events/${event.slug}/status/${lineToken(choseLine.id, (await db.registrant.findUniqueOrThrow({ where: { id: choseLine.id }, select: { statusTokenHash: true } })).statusTokenHash)}`;
  html = await (await fetch(choseLineStatus)).text();
  const useEmail = formsFrom(html).find((form) => form.includes("ใช้อีเมลแทน"));
  ensure(html.includes("ยังเชื่อมไม่สำเร็จ") && useEmail?.includes('name="email"'), "Status page does not offer email (with an address field) to an unconnected LINE chooser");
  const switchTo = (email) => fetch(choseLineStatus, { method: "POST", redirect: "manual", headers: { origin: base }, body: formDataFrom(useEmail, email === null ? {} : { email }) });
  response = await switchTo(null);
  ensure(location(response).includes("line=email-invalid"), `Switch to email accepted without an address: ${location(response)}`);
  response = await switchTo(`chose-email-${suffix}@example.invalid`);
  ensure(location(response).includes("line=email-taken"), `Switch to email took an address already registered: ${location(response)}`);
  response = await switchTo(`Switched-${suffix}@Example.invalid`);
  const switched = await db.registrant.findUniqueOrThrow({ where: { id: choseLine.id }, select: { notifyVia: true, email: true, dedupeKey: true } });
  ensure(location(response).includes("line=unlinked") && switched.notifyVia === "EMAIL" && switched.email === `switched-${suffix}@example.invalid` && switched.dedupeKey === switched.email, "\"Use email instead\" did not switch the channel and store the address");
  ensure(await db.notificationLog.count({ where: { registrantId: choseLine.id, channel: "EMAIL" } }) === 1, "Switching to email did not email the current status");
  // Switched off: the form offers email only, and a forged LINE choice is stored as email.
  await db.systemSetting.update({ where: { key: "lineLogin" }, data: { enabled: false } });
  ensure(!(await (await fetch(publicUrl)).text()).includes('name="notifyVia"'), "LINE offered on the form while switched off");
  response = await registerAs("forced-line", "LINE");
  ensure(location(response).includes("/status/") && (await db.registrant.findFirstOrThrow({ where: { eventId: event.id, email: `forced-line-${suffix}@example.invalid` }, select: { notifyVia: true } })).notifyVia === "EMAIL", "LINE choice accepted while switched off");
  await db.systemSetting.update({ where: { key: "lineLogin" }, data: { enabled: true } });

  // Connecting a LINE account that already registered for the event: the new registration is cancelled, its seat
  // goes to the waitlist, and the original is returned so the callback can open it.
  const { linkLineAccount } = await import("../src/server/line/link.ts");
  const dupEvent = await db.event.create({ data: {
    slug: `line-dup-smoke-${suffix}`, title: "LINE duplicate smoke", ownerId: admin.id, status: "PUBLISHED", autoApprove: true, waitlistEnabled: true, waitlistPromotion: "AUTO",
    registrationDeadline: new Date("2031-12-30T16:59:59.999Z"), fields: [{ key: "name", label: "ชื่อ", type: "text", required: true }],
    days: { create: [{ date: new Date("2031-12-02T00:00:00Z"), maxSeats: 2 }] },
  } });
  eventIds.push(dupEvent.id);
  const dupDay = await db.eventDay.findFirstOrThrow({ where: { eventId: dupEvent.id } });
  const dupUser = `U${"2".repeat(32)}`;
  const seat = (label, data, status = "APPROVED") => db.registrant.create({ data: {
    eventId: dupEvent.id, status, autoApproveAtRegistration: true, consentedAt: new Date(), answers: { name: label }, displayName: label, statusTokenHash: hash(`${token}-dup-${label}`),
    qrCode: status === "APPROVED" ? `dup-qr-${label}-${suffix}` : null, ...data,
    days: { create: [{ eventDayId: dupDay.id, status, ...(status === "WAITLISTED" ? { waitlistedAt: new Date() } : {}) }] },
  } });
  const original = await seat("original", { lineUserId: dupUser, notifyVia: "LINE", dedupeKey: `line:${dupUser}` });
  const second = await seat("second", { notifyVia: "LINE" });
  const waiting = await seat("waiting", { email: `waiting-${suffix}@example.invalid`, dedupeKey: `waiting-${suffix}@example.invalid` }, "WAITLISTED");
  const outcome = await linkLineAccount(second.id, dupUser);
  ensure(outcome.result === "duplicate" && outcome.original?.id === original.id, `Duplicate LINE not detected or original not returned: ${JSON.stringify(outcome)}`);
  const afterDup = await db.registrant.findMany({ where: { id: { in: [second.id, waiting.id] } }, select: { id: true, status: true, lineUserId: true } });
  ensure(afterDup.find((item) => item.id === second.id)?.status === "CANCELLED" && afterDup.find((item) => item.id === second.id)?.lineUserId === null, "Duplicate registration was not cancelled");
  ensure(afterDup.find((item) => item.id === waiting.id)?.status === "APPROVED", "Freed seat did not go to the waitlist");
  html = await (await fetch(`${base}/events/${dupEvent.slug}/status/${lineToken(original.id, original.statusTokenHash)}?line=duplicate`)).text();
  ensure(html.includes("ระบบยกเลิกใบสมัครที่ซ้ำให้แล้ว"), "Original registration page does not explain the duplicate");

  console.log("LINE smoke passed: status links, outbox + failed delivery, resend limit, admin switch, unlink, login guards, channel choice at registration, duplicate LINE account.");
} finally {
  await db.systemSetting.deleteMany({ where: { key: "lineLogin" } });
  if (savedSwitch) await db.systemSetting.create({ data: savedSwitch });
  for (const id of eventIds) await db.event.deleteMany({ where: { id } });
  await db.$disconnect();
}
