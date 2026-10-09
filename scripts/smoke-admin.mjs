import { randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import { compare } from "bcryptjs";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = "http://localhost:3100";
const token = randomUUID();
const testEmail = `admin-smoke-${token}@example.invalid`;
let testUserId;
let inviteUserId;
let eventId;

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function formsFrom(html) {
  return html.split("<form").slice(1).map((part) => `<form${part.split("</form>")[0]}</form>`);
}

function formDataFrom(html, values = {}) {
  const form = new FormData();
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) {
    form.set(match[1], (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  }
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  return form;
}

async function login(email, password, ip = `smoke-login-${randomUUID()}`) {
  let response = await fetch(`${base}/api/auth/csrf`, { headers: { "x-forwarded-for": ip } });
  const csrfToken = (await response.json()).csrfToken;
  const cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  response = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${base}/organizer` }),
    redirect: "manual",
  });
  return { response, location: response.headers.get("location") ?? "", ok: response.status === 302 && !(response.headers.get("location") ?? "").includes("error=") };
}

async function submit(url, html, values = {}, cookie) {
  const response = await fetch(url, {
    method: "POST",
    headers: { origin: base, cookie },
    body: formDataFrom(html, values),
    redirect: "manual",
  });
  return response;
}

try {
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" } });
  let response = await fetch(`${base}/api/auth/csrf`);
  const csrfToken = (await response.json()).csrfToken;
  let cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  response = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email: admin.email, password: "CheckInHub123!", callbackUrl: `${base}/admin` }),
    redirect: "manual",
  });
  ensure(response.status === 302, "Admin login failed");
  cookie += `; ${response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;

  let page = await (await fetch(`${base}/admin`, { headers: { cookie } })).text();
  let createForm = formsFrom(page).find((form) => form.includes('id="new-user-name"'));
  ensure(createForm, "Admin create-user form missing");
  response = await submit(`${base}/admin`, createForm, {
    name: "Admin smoke user", email: testEmail, password: `Smoke-${token}-Password`, role: "ADMIN",
  }, cookie);
  ensure(response.status === 303, `User creation did not redirect: ${response.status}`);
  let user = await db.user.findUniqueOrThrow({ where: { email: testEmail } });
  testUserId = user.id;
  ensure(user.role === "ADMIN" && await compare(`Smoke-${token}-Password`, user.passwordHash), "Created account role or password hash is incorrect");
  ensure(await db.auditLog.findFirst({ where: { actorId: admin.id, action: "ADMIN_USER_CREATED", target: user.id } }), "Account creation was not audited");

  page = await (await fetch(`${base}/admin`, { headers: { cookie } })).text();
  let detailsForm = formsFrom(page).find((form) => form.includes(`name="userId" value="${user.id}"`) && form.includes('name="password"'));
  ensure(detailsForm, "Admin account-details form missing");
  response = await submit(`${base}/admin`, detailsForm, {
    userId: user.id, name: "Updated smoke user", email: `updated-${testEmail}`, password: `Reset-${token}-Password`,
  }, cookie);
  ensure(response.status === 303, `Account update did not redirect: ${response.status}`);
  user = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  ensure(user.name === "Updated smoke user" && user.email === `updated-${testEmail}` && await compare(`Reset-${token}-Password`, user.passwordHash), "Account update did not persist");

  page = await (await fetch(`${base}/admin`, { headers: { cookie } })).text();
  const roleForm = formsFrom(page).find((form) => form.includes(`name="userId" value="${user.id}"`) && form.includes('name="role"'));
  ensure(roleForm, "Admin role form missing");
  response = await submit(`${base}/admin`, roleForm, { userId: user.id, role: "ORGANIZER" }, cookie);
  ensure(response.status === 200, `Role update failed: ${response.status}`);
  user = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  ensure(user.role === "ORGANIZER", "Account role did not update");

  const activeForm = formsFrom(page).find((form) => form.includes(`name="userId" value="${user.id}"`) && form.includes('name="active"'));
  ensure(activeForm, "Admin account status form missing");
  response = await submit(`${base}/admin`, activeForm, { userId: user.id, active: "false" }, cookie);
  ensure(response.status === 200, `Account disable failed: ${response.status}`);
  user = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  ensure(!user.isActive, "Account was not disabled");
  response = await submit(`${base}/admin`, activeForm, { userId: user.id, active: "true" }, cookie);
  ensure(response.status === 200, `Account re-enable failed: ${response.status}`);
  user = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  ensure(user.isActive, "Account was not re-enabled");

  // Invitation: blank password creates an account that sets its own password from a one-time link.
  const inviteEmail = `invite-${token}@example.invalid`;
  page = await (await fetch(`${base}/admin`, { headers: { cookie } })).text();
  createForm = formsFrom(page).find((form) => form.includes('id="new-user-name"'));
  response = await submit(`${base}/admin`, createForm, { name: "Invited smoke user", email: inviteEmail, password: "", role: "ORGANIZER" }, cookie);
  const inviteLocation = response.headers.get("location") ?? "";
  ensure(response.status === 303 && inviteLocation.includes("/admin/account-link?token="), `Invitation did not return a link: ${response.status} ${inviteLocation}`);
  const invited = await db.user.findUniqueOrThrow({ where: { email: inviteEmail } });
  inviteUserId = invited.id;
  ensure(invited.passwordHash === null, "Invited account already has a password");
  ensure(!(await login(inviteEmail, "anything-long-enough")).ok, "Invited account without password could sign in");
  const inviteToken = new URL(inviteLocation, base).searchParams.get("token");
  const linkPage = await (await fetch(`${base}/admin/account-link?token=${inviteToken}`, { headers: { cookie } })).text();
  ensure(linkPage.includes(`/account/setup/${inviteToken}`), "Admin link page did not show the invitation link");
  const setupUrl = `${base}/account/setup/${inviteToken}`;
  let setupHtml = await (await fetch(setupUrl)).text();
  let setupForm = formsFrom(setupHtml).find((form) => form.includes('name="confirm"'));
  ensure(setupForm, "Invitation setup form missing");
  response = await submit(setupUrl, setupForm, { password: "short", confirm: "short" });
  ensure(response.headers.get("location")?.includes("error=password"), "Short invitation password was accepted");
  const invitePassword = `Invite-${token}-Pass`;
  response = await submit(setupUrl, setupForm, { password: invitePassword, confirm: invitePassword });
  ensure(response.status === 303 && response.headers.get("location")?.includes("/login?notice=password-set"), `Invitation acceptance failed: ${response.headers.get("location")}`);
  ensure(await compare(invitePassword, (await db.user.findUniqueOrThrow({ where: { id: invited.id } })).passwordHash), "Invitation password not stored");
  response = await submit(setupUrl, setupForm, { password: `${invitePassword}-again`, confirm: `${invitePassword}-again` });
  ensure(response.headers.get("location")?.includes("error=invalid"), "Invitation link was reusable");
  ensure((await login(inviteEmail, invitePassword)).ok, "Invited user could not sign in after setting a password");

  // Admin-issued reset link replaces the password once.
  page = await (await fetch(`${base}/admin`, { headers: { cookie } })).text();
  const resetForm = formsFrom(page).find((form) => form.includes(`name="userId" value="${invited.id}"`) && form.includes("ออกลิงก์รีเซ็ตรหัสผ่าน"));
  ensure(resetForm, "Reset-link form missing");
  response = await submit(`${base}/admin`, resetForm, {}, cookie);
  const resetToken = new URL(response.headers.get("location") ?? "/", base).searchParams.get("token");
  ensure(resetToken && (await db.userToken.findFirst({ where: { userId: invited.id, kind: "RESET", usedAt: null } }))?.expiresAt.getTime() - Date.now() <= 30 * 60 * 1000, "Reset link was not issued with a 30-minute expiry");
  const resetUrl = `${base}/account/setup/${resetToken}`;
  setupHtml = await (await fetch(resetUrl)).text();
  setupForm = formsFrom(setupHtml).find((form) => form.includes('name="confirm"'));
  const resetPassword = `Reset-${token}-Pass2`;
  response = await submit(resetUrl, setupForm, { password: resetPassword, confirm: resetPassword });
  ensure(response.headers.get("location")?.includes("notice=password-set"), "Reset link failed");
  ensure((await login(inviteEmail, resetPassword)).ok && !(await login(inviteEmail, invitePassword)).ok, "Reset did not replace the password");
  ensure(await db.auditLog.count({ where: { target: invited.id, action: { in: ["ACCOUNT_INVITE_ACCEPTED", "ADMIN_PASSWORD_RESET_LINK_ISSUED", "ACCOUNT_PASSWORD_RESET"] } } }) === 3, "Account link events were not audited");

  // Five failures lock the account for 15 minutes, even with the right password and a different IP.
  for (let attempt = 0; attempt < 5; attempt++) ensure(!(await login(inviteEmail, "wrong-password-value")).ok, "Wrong password accepted");
  const throttled = await login(inviteEmail, resetPassword);
  ensure(!throttled.ok && throttled.location.includes("rate_limited"), `Account login was not rate limited: ${throttled.location}`);

  const auditPage = await (await fetch(`${base}/admin?view=audit&scope=system&actor=${encodeURIComponent(admin.email)}`, { headers: { cookie } })).text();
  ensure(auditPage.includes("ADMIN_INVITE_LINK_ISSUED") === false && auditPage.includes("ADMIN_PASSWORD_RESET_LINK_ISSUED") && !auditPage.includes("ACCOUNT_INVITE_ACCEPTED"), "Audit log actor filter did not narrow results");

  // Access states: non-admins get a real 403, anonymous visitors are sent to login with a safe return path.
  const organizerLogin = await login("organizer@checkinhub.local", "CheckInHub123!");
  const organizerCookie = [organizerLogin.response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")].join("; ");
  ensure(organizerLogin.ok, "Seed organizer could not sign in");
  ensure((await fetch(`${base}/admin`, { headers: { cookie: organizerCookie }, redirect: "manual" })).status === 403, "Non-admin did not receive 403 on /admin");
  response = await fetch(`${base}/organizer/some-event/registrants?status=PENDING`, { redirect: "manual" });
  ensure(response.headers.get("location")?.includes("/login?next=%2Forganizer%2Fsome-event%2Fregistrants%3Fstatus%3DPENDING"), `Anonymous deep link did not keep a return path: ${response.headers.get("location")}`);
  const loginPage = await (await fetch(`${base}/login?next=${encodeURIComponent("https://evil.example/")}`)).text();
  ensure(!loginPage.includes('name="next"'), "Login form accepted an off-site return path");

  const event = await db.event.create({ data: {
    slug: `admin-delete-${token}`, title: "Admin delete smoke", ownerId: admin.id,
    status: "CLOSED", fields: [], days: { create: [{ date: new Date("2032-01-10T00:00:00.000Z") }] },
  } });
  eventId = event.id;
  const day = await db.eventDay.findFirstOrThrow({ where: { eventId } });
  const session = await db.session.create({ data: { eventId, eventDayId: day.id, label: "Delete smoke session" } });
  const person = await db.registrant.create({ data: {
    eventId, email: `delete-${token}@example.invalid`, answers: {}, status: "APPROVED",
    qrCode: randomUUID(), statusTokenHash: randomUUID(),
    days: { create: [{ eventDayId: day.id }] },
  } });
  await db.checkIn.create({ data: { sessionId: session.id, registrantId: person.id, checkedInById: admin.id } });

  const eventPage = await (await fetch(`${base}/admin/events/${eventId}`, { headers: { cookie } })).text();
  const deleteForm = formsFrom(eventPage).find((form) => form.includes("ลบโครงการ"));
  ensure(deleteForm, "Admin event-delete form missing");
  response = await submit(`${base}/admin/events/${eventId}`, deleteForm, {}, cookie);
  ensure(response.status === 303 && response.headers.get("location")?.includes("deleted=archived"), "Event with registrants was not archived");
  const archived = await db.event.findUnique({ where: { id: eventId } });
  ensure(archived?.deletedAt && archived.status === "CLOSED", "Event with registrants was not soft deleted");
  ensure(await db.checkIn.findFirst({ where: { registrantId: person.id, sessionId: session.id } }), "Soft delete removed check-in history");
  ensure(await db.auditLog.findFirst({ where: { actorId: admin.id, action: "EVENT_SOFT_DELETED", target: eventId } }), "Event soft delete was not audited");

  process.stdout.write("Admin accounts (create/edit/role/activation, invite and reset links, login throttle), audit filters and event soft delete passed.\n");
} finally {
  if (eventId) await db.event.deleteMany({ where: { id: eventId } });
  if (inviteUserId) await db.auditLog.deleteMany({ where: { actorId: inviteUserId } });
  for (const id of [testUserId, inviteUserId].filter(Boolean)) await db.user.deleteMany({ where: { id } });
  await db.$disconnect();
}
