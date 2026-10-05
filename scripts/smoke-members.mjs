// Step 5 collaborators: adding by the email a picked person carries, the guards on inactive/unknown people, and the
// owner-only rule. The AD search itself (name lookup, UPN re-lookup) needs the real directory and is checked by hand;
// with LDAP configured, an unknown address is looked up in AD and refused when no allowed account has that UPN.
import { randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient({ errorFormat: "minimal" });
const base = "http://localhost:3100";

function ensure(value, message) { if (!value) throw new Error(message); }
const formsFrom = (html) => html.split("<form").slice(1).map((part) => `<form${part.split("</form>")[0]}</form>`);
function formDataFrom(html, values = {}) {
  const data = new FormData();
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) data.set(match[1], (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
async function login(email) {
  let response = await fetch(`${base}/api/auth/csrf`);
  const csrfToken = (await response.json()).csrfToken;
  const cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  response = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken, email, password: "CheckInHub123!", callbackUrl: `${base}/organizer` }), redirect: "manual" });
  return `${cookie}; ${response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;
}

const suffix = randomUUID();
let eventId;
const userIds = [];
try {
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" }, select: { id: true } });
  const event = await db.event.create({ data: { slug: `members-smoke-${suffix}`, title: "Members smoke", ownerId: admin.id, fields: [] } });
  eventId = event.id;
  const colleague = await db.user.create({ data: { name: `Colleague ${suffix}`, email: `colleague-${suffix}@example.invalid`, role: "ORGANIZER" } });
  const disabled = await db.user.create({ data: { name: `Disabled ${suffix}`, email: `disabled-${suffix}@example.invalid`, role: "ORGANIZER", isActive: false } });
  userIds.push(colleague.id, disabled.id);

  const cookie = await login("admin@checkinhub.local");
  const stepUrl = `${base}/organizer/${eventId}?step=5`;
  const html = await (await fetch(stepUrl, { headers: { cookie } })).text();
  const addForm = formsFrom(html).find((form) => form.includes('name="role"') && form.includes("memberQuery"));
  ensure(addForm, "Step 5 has no search-and-add form");
  const add = (email, role = "CHECKIN_ONLY") => fetch(stepUrl, { method: "POST", redirect: "manual", headers: { origin: base, cookie }, body: formDataFrom(addForm, { email, role }) });
  const location = (response) => response.headers.get("location") ?? "";

  let response = await add(colleague.email);
  ensure(location(response).includes("saved=member"), `Adding an account failed: ${location(response)}`);
  const membership = await db.eventOrganizer.findUnique({ where: { eventId_userId: { eventId, userId: colleague.id } } });
  ensure(membership?.role === "CHECKIN_ONLY", "Membership not stored with the chosen role");

  response = await add(disabled.email);
  ensure(location(response).includes("error=member-not-found"), `A disabled account was added: ${location(response)}`);
  // Not an account here and (with LDAP on) not an allowed AD account: refused, and no account is created.
  const stranger = `nobody-${suffix}@example.invalid`;
  response = await add(stranger);
  ensure(/error=(member-not-found|directory-unavailable)/.test(location(response)), `An unknown address was added: ${location(response)}`);
  ensure(!(await db.user.findUnique({ where: { email: stranger } })), "An account was created for an unknown address");

  // A collaborator (not the owner) cannot add people: the action answers 404.
  await db.user.update({ where: { id: colleague.id }, data: { passwordHash: (await db.user.findUniqueOrThrow({ where: { id: admin.id }, select: { passwordHash: true } })).passwordHash } });
  await db.eventOrganizer.update({ where: { eventId_userId: { eventId, userId: colleague.id } }, data: { role: "FULL" } });
  const collaboratorCookie = await login(colleague.email);
  response = await fetch(stepUrl, { method: "POST", redirect: "manual", headers: { origin: base, cookie: collaboratorCookie }, body: formDataFrom(addForm, { email: disabled.email, role: "FULL" }) });
  ensure(response.status === 404 && !(await db.eventOrganizer.findUnique({ where: { eventId_userId: { eventId, userId: disabled.id } } })), `A collaborator could add members: ${response.status}`);

  console.log("Members smoke passed: add by picked email, role stored, disabled/unknown refused without creating accounts, owner-only.");
} finally {
  if (eventId) await db.event.deleteMany({ where: { id: eventId } });
  if (userIds.length) { await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: userIds } }] } }); await db.user.deleteMany({ where: { id: { in: userIds } } }); }
  await db.$disconnect();
}
