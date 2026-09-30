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
    slug: `line-smoke-${suffix}`, title: "LINE smoke", ownerId: admin.id, status: "PUBLISHED", autoApprove: false,
    registrationDeadline: new Date("2031-12-30T16:59:59.999Z"), fields: [{ key: "name", label: "ชื่อ", type: "text", required: true, showOnCheckin: true }],
    days: { create: [{ date: new Date("2031-12-01T00:00:00Z"), maxSeats: 10 }] },
  } });
  eventIds.push(event.id);
  const day = await db.eventDay.findFirstOrThrow({ where: { eventId: event.id } });
  const token = `line-smoke-${suffix}`;
  const makePerson = (label, lineUserId) => db.registrant.create({ data: {
    eventId: event.id, email: `${label}-${suffix}@example.invalid`, dedupeKey: `${label}-${suffix}@example.invalid`, status: "PENDING", consentedAt: new Date(),
    answers: { name: `LINE ${label}` }, displayName: `LINE ${label}`, statusTokenHash: hash(`${token}-${label}`), lineUserId, notifyVia: lineUserId ? "BOTH" : "EMAIL",
    days: { create: [{ eventDayId: day.id, status: "PENDING", pendingSince: new Date() }] },
  } });
  // A well-formed but unknown LINE user: LINE refuses the push.
  const linked = await makePerson("linked", `U${"0".repeat(32)}`);
  const plain = await makePerson("plain", null);
  const statusUrl = (label) => `${base}/events/${event.slug}/status/${token}-${label}`;

  // Status page offers LINE to people who have not linked, and shows the linked state otherwise.
  let html = await (await fetch(statusUrl("plain"))).text();
  ensure(html.includes("รับแจ้งผลทาง LINE") && formsFrom(html).some((form) => form.includes("รับแจ้งผลทาง LINE")), "Connect-LINE button missing on the status page");
  html = await (await fetch(statusUrl("linked"))).text();
  ensure(html.includes("เลิกรับแจ้งเตือนทาง LINE"), "Linked state missing on the status page");

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
  // People without LINE get no queue rows.
  const plainApprove = formsFrom(await (await fetch(`${base}/organizer/${event.id}/registrants?selected=${plain.id}`, { headers: { cookie } })).text()).find((form) => />อนุมัติ<\/button>/.test(form));
  await post(`${base}/organizer/${event.id}/registrants`, plainApprove, cookie);
  ensure(await db.notificationLog.count({ where: { registrantId: plain.id } }) === 0, "Notification queued for someone without LINE");

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
  ensure(!(await (await fetch(statusUrl("plain"))).text()).includes("รับแจ้งผลทาง LINE"), "Connect-LINE shown while switched off");
  html = await (await fetch(`${base}/organizer/${event.id}/registrants?selected=${linked.id}`, { headers: { cookie } })).text();
  const cancel = formsFrom(html).find((form) => form.includes("ยกเลิกการเข้าร่วม"));
  ensure(cancel, "Organizer cancel form missing");
  await post(`${base}/organizer/${event.id}/registrants`, cancel, cookie);
  const skipped = await waitFor(() => db.notificationLog.findFirst({ where: { registrantId: linked.id, status: "SKIPPED", createdAt: { gte: startedAt } } }), "message skipped while LINE is off");
  ensure(skipped.error?.includes("ปิดอยู่"), `Skipped for the wrong reason: ${skipped.error}`);
  await db.systemSetting.update({ where: { key: "lineLogin" }, data: { enabled: true } });

  // Unlinking from the status page clears the LINE ID.
  html = await (await fetch(statusUrl("linked"))).text();
  const unlink = formsFrom(html).find((form) => form.includes("เลิกรับแจ้งเตือนทาง LINE"));
  ensure(unlink, "Unlink form missing");
  response = await post(statusUrl("linked"), unlink);
  ensure(location(response).includes("line=unlinked"), `Unlink failed: ${location(response)}`);
  const after = await db.registrant.findUniqueOrThrow({ where: { id: linked.id }, select: { lineUserId: true, notifyVia: true } });
  ensure(after.lineUserId === null && after.notifyVia === "EMAIL", "Unlink did not clear LINE");

  // Starting the link goes to LINE Login with the add-friend prompt and sets the one-time state cookie.
  html = await (await fetch(statusUrl("plain"))).text();
  response = await post(statusUrl("plain"), formsFrom(html).find((form) => form.includes("รับแจ้งผลทาง LINE")));
  ensure(response.status === 303 && location(response).startsWith("https://access.line.me/oauth2/v2.1/authorize?") && location(response).includes("bot_prompt=aggressive"), `Connect did not go to LINE Login: ${location(response)}`);
  const stateCookie = response.headers.getSetCookie().find((item) => item.startsWith("line-link="));
  ensure(stateCookie?.includes("HttpOnly") && stateCookie.includes("Path=/api/line"), "LINE state cookie missing or not httpOnly");
  // Callback guards: no cookie → expired page; wrong state → back with an error; forged cookie → expired.
  response = await fetch(`${base}/api/line/callback?code=x&state=y`, { redirect: "manual" });
  ensure(response.status === 400 && (await response.text()).includes("หมดอายุ"), "Callback without a state cookie not refused");
  response = await fetch(`${base}/api/line/callback?code=x&state=wrong`, { redirect: "manual", headers: { cookie: stateCookie.split(";")[0] } });
  ensure(response.status === 303 && location(response).includes("line=error"), `Callback with a wrong state not refused: ${location(response)}`);
  response = await fetch(`${base}/api/line/callback?code=x&state=y`, { redirect: "manual", headers: { cookie: `line-link=${Buffer.from("{}").toString("base64url")}.forged` } });
  ensure(response.status === 400, "Callback accepted a forged state cookie");

  console.log("LINE smoke passed: status links, outbox + failed delivery, resend limit, admin switch, unlink, login guards.");
} finally {
  await db.systemSetting.deleteMany({ where: { key: "lineLogin" } });
  if (savedSwitch) await db.systemSetting.create({ data: savedSwitch });
  for (const id of eventIds) await db.event.deleteMany({ where: { id } });
  await db.$disconnect();
}
