// Form changes after people registered: stored names follow a relabelled name field, files of removed fields stay
// downloadable, self-edit names the field that failed and marks questions added later, a page opened before the
// form changed gets a clear message (self-edit and public form), plus the admin-wide PDPA request list.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = "http://localhost:3100";
const eventIds = [];
const files = [];

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
const html = async (url, cookie) => (await fetch(url, { headers: cookie ? { cookie } : {} })).text();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login(email, password) {
  let response = await fetch(`${base}/api/auth/csrf`);
  const csrfToken = (await response.json()).csrfToken;
  const cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  response = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${base}/organizer` }), redirect: "manual" });
  ensure(response.status === 302 && !location(response).includes("error="), `Login failed for ${email}`);
  return `${cookie}; ${response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;
}

try {
  const cookie = await login("admin@checkinhub.local", "CheckInHub123!");
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" } });
  const fields = [
    { key: "org", label: "หน่วยงาน", type: "text", required: true },
    { key: "person", label: "ผู้เข้าร่วม", type: "text", required: false },
  ];
  const event = await db.event.create({ data: {
    slug: `fc-${randomUUID()}`, title: "Form changes smoke", ownerId: admin.id, status: "PUBLISHED", autoApprove: true,
    registrationDeadline: new Date("2031-12-31T16:59:59.999Z"), fields,
    days: { create: [{ date: new Date("2031-10-01T00:00:00.000Z") }] },
  } });
  eventIds.push(event.id);
  const day = await db.eventDay.findFirstOrThrow({ where: { eventId: event.id } });

  // A file stored under a key that is not (any longer) in the form.
  const storageKey = `${randomUUID()}.pdf`;
  mkdirSync(join(process.cwd(), ".local-uploads"), { recursive: true });
  writeFileSync(join(process.cwd(), ".local-uploads", storageKey), "%PDF-1.4 smoke");
  files.push(storageKey);
  const token = `fc-${randomUUID()}`;
  const email = `${randomUUID()}@example.invalid`;
  const person = await db.registrant.create({ data: {
    eventId: event.id, email, dedupeKey: email, status: "APPROVED", autoApproveAtRegistration: true, qrCode: randomUUID(), approvedAt: new Date(),
    answers: { org: "กรมตัวอย่าง", person: "สมศรี ใจดี", oldProof: { storageKey, originalName: "หลักฐานเดิม.pdf", contentType: "application/pdf", size: 14 } },
    displayName: "กรมตัวอย่าง", statusTokenHash: createHash("sha256").update(token).digest("hex"),
    days: { create: [{ eventDayId: day.id, status: "APPROVED" }] },
  } });

  // Relabelling "person" as a name field re-derives stored display names.
  const settingsUrl = `${base}/organizer/${event.id}`;
  const panel = formsFrom(await html(`${settingsUrl}?step=3&field=person`, cookie)).find((form) => form.includes('name="label"') && form.includes("บันทึกฟิลด์</button>"));
  ensure(panel, "Field editor for 'person' missing");
  let response = await post(settingsUrl, panel, { label: "ชื่อผู้เข้าร่วม" }, { cookie });
  ensure(response.status === 303, `Relabel failed: ${response.status} ${location(response)}`);
  ensure((await db.registrant.findUniqueOrThrow({ where: { id: person.id } })).displayName === "สมศรี ใจดี", "displayName did not follow the relabelled name field");

  // The removed field's file is listed and downloadable (audited).
  const detail = await html(`${settingsUrl}/registrants?selected=${person.id}`, cookie);
  ensure(detail.includes("หลักฐานเดิม.pdf") && detail.includes("/files/oldProof?i=0"), "File of a removed field is not listed");
  response = await fetch(`${settingsUrl}/registrants/${person.id}/files/oldProof?i=0`, { headers: { cookie } });
  ensure(response.status === 200 && (await response.text()).startsWith("%PDF"), `File of a removed field not downloadable (${response.status})`);
  ensure(await db.auditLog.count({ where: { eventId: event.id, action: "FILE_DOWNLOADED", target: person.id } }) === 1, "Download not audited");
  ensure((await fetch(`${settingsUrl}/registrants/${person.id}/files/org`, { headers: { cookie } })).status === 404, "A text field was served as a file");

  // Organizer adds a required question later: self-edit marks it and says exactly what is missing.
  const statusUrl = `${base}/events/${event.slug}/status/${token}`;
  const staleEdit = formsFrom(await html(`${statusUrl}/edit`)).find((part) => part.includes("บันทึกการแก้ไข"));
  const next = [...(await db.event.findUniqueOrThrow({ where: { id: event.id } })).fields, { key: "position", label: "ตำแหน่ง", type: "text", required: true }, { key: "certificate", label: "ใบรับรอง", type: "file", required: true, acceptedFileTypes: ["pdf"], maxFileSizeMb: 1 }];
  await db.event.update({ where: { id: event.id }, data: { fields: next, fieldsVersion: { increment: 1 } } });
  const editPage = await html(`${statusUrl}/edit`);
  ensure(editPage.includes("ผู้จัดเพิ่มคำถามบังคับหลังจากคุณลงทะเบียน 1 ข้อ") && editPage.includes(">ใหม่<"), "Question added later is not marked");
  const editForm = formsFrom(editPage).find((part) => part.includes("บันทึกการแก้ไข"));
  response = await post(`${statusUrl}/edit`, editForm, { "answer:org": "กรมใหม่", "answer:person": "สมศรี ใจดี" });
  let target = new URL(location(response), base);
  ensure(target.searchParams.get("error") === "invalid" && target.searchParams.get("field") === "position" && target.searchParams.get("reason") === "required", `Unexpected self-edit result: ${target}`);
  ensure((await html(target.toString())).includes('กรุณากรอก &quot;ตำแหน่ง&quot;') || (await html(target.toString())).includes('กรุณากรอก "ตำแหน่ง"'), "Edit page does not name the missing field");
  response = await post(`${statusUrl}/edit`, editForm, { "answer:org": "กรมใหม่", "answer:person": "สมศรี ใจดี", "answer:position": "นักวิชาการ" });
  ensure(location(response).includes("updated=1"), `Self-edit with the new answer failed (required file field must not block it): ${location(response)}`);
  // A page rendered before the change reports the form change instead of a generic error.
  response = await post(`${statusUrl}/edit`, staleEdit, { "answer:org": "กรมเก่า", "answer:person": "สมศรี ใจดี" });
  ensure(new URL(location(response), base).searchParams.get("error") === "form-changed", `Stale self-edit page not recognised: ${location(response)}`);

  // Same for the public registration form.
  const publicEvent = await db.event.create({ data: {
    slug: `fc-public-${randomUUID()}`, title: "Form changes public smoke", ownerId: admin.id, status: "PUBLISHED", autoApprove: true,
    registrationDeadline: new Date("2031-12-31T16:59:59.999Z"), fields: [{ key: "name", label: "ชื่อ", type: "text", required: true }],
    days: { create: [{ date: new Date("2031-10-02T00:00:00.000Z") }] },
  } });
  eventIds.push(publicEvent.id);
  const publicDay = await db.eventDay.findFirstOrThrow({ where: { eventId: publicEvent.id } });
  const publicUrl = `${base}/events/${publicEvent.slug}`;
  const publicForm = formsFrom(await html(publicUrl)).find((part) => part.includes('name="consent"'));
  await db.event.update({ where: { id: publicEvent.id }, data: { fields: [{ key: "name", label: "ชื่อ", type: "text", required: true }, { key: "phone", label: "โทรศัพท์", type: "tel", required: true }], fieldsVersion: { increment: 1 } } });
  await wait(3100);
  response = await post(publicUrl, publicForm, { email: `${randomUUID()}@example.invalid`, dayId: publicDay.id, "answer:name": "ผู้สมัคร", consent: "on" }, { "x-forwarded-for": `fc-${randomUUID()}` });
  ensure(location(response).includes("error=form-changed"), `Stale public form not recognised: ${location(response)}`);
  ensure((await html(`${base}${location(response)}`)).includes("ผู้จัดเพิ่งแก้แบบฟอร์มระหว่างที่คุณกรอก"), "Public page does not explain the form change");

  // Admin sees open PDPA requests from every event.
  await db.dataRequest.create({ data: { eventId: event.id, registrantId: person.id } });
  const requestsPage = await html(`${base}/admin?view=requests`, cookie);
  ensure(requestsPage.includes("Form changes smoke") && requestsPage.includes("สมศรี ใจดี") && requestsPage.includes("รอดำเนินการ"), "Admin request list missing the open request");

  console.log("Form changes: display-name refresh, removed-field files, self-edit problems/new questions, stale-form messages and admin PDPA list passed.");
} finally {
  for (const id of eventIds) await db.event.deleteMany({ where: { id } });
  for (const key of files) rmSync(join(process.cwd(), ".local-uploads", key), { force: true });
  await db.$disconnect();
}
