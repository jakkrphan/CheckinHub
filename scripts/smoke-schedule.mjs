import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());

const db = new PrismaClient();
const base = "http://localhost:3100";
let ownerId;
let eventId;
let coverKey;
let createdEventId;
let createdCoverKey;

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function formsFrom(html) {
  return html.split("<form").slice(1).map((part) => `<form${part.split("</form>")[0]}</form>`);
}

function formDataFrom(html, values = {}) {
  const form = new FormData();
  const hidden = /<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g;
  for (const match of html.matchAll(hidden)) {
    form.set(match[1], (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  }
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      form.delete(name);
      for (const item of value) form.append(name, item);
    } else {
      form.set(name, value);
    }
  }
  return form;
}

try {
  const token = randomUUID();
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" } });
  const owner = await db.user.create({
    data: { name: "Schedule smoke owner", email: `smoke-${token}@example.invalid`, passwordHash: "not-used", role: "ORGANIZER" },
  });
  ownerId = owner.id;
  const event = await db.event.create({
    data: { slug: `smoke-${token}`, title: "Schedule smoke", ownerId, status: "DRAFT", fields: [] },
  });
  eventId = event.id;

  let response = await fetch(`${base}/api/auth/csrf`);
  const csrfToken = (await response.json()).csrfToken;
  let cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  response = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email: admin.email, password: "CheckInHub123!", callbackUrl: `${base}/organizer` }),
    redirect: "manual",
  });
  ensure(response.status === 302, "Admin login failed");
  cookie += `; ${response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;

  const createPage = await (await fetch(`${base}/organizer/new`, { headers: { cookie } })).text();
  const createForm = formsFrom(createPage).find((form) => form.includes('name="coverImage"') && form.includes('name="title"'));
  ensure(createForm, "New event wizard cover input missing");
  response = await fetch(`${base}/organizer/new`, { method: "POST", headers: { cookie, origin: base }, body: formDataFrom(createForm, {
    title: `Cover create ${token}`, description: "", location: "", eventType: "INTERNAL", deadlineDate: "2031-12-31",
    coverImage: new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p7sAAAAASUVORK5CYII=", "base64")], "created-cover.png", { type: "image/png" }),
  }), redirect: "manual" });
  ensure(response.status === 303 && /\/organizer\/[^/]+\?step=2/.test(response.headers.get("location") ?? ""), "Create event wizard did not continue to step 2");
  createdEventId = new URL(response.headers.get("location"), base).pathname.split("/").at(-1);
  const createdEvent = await db.event.findUniqueOrThrow({ where: { id: createdEventId } });
  createdCoverKey = createdEvent.coverImageKey;
  ensure(createdEvent.coverImageUrl === `/events/${createdEvent.slug}/cover` && createdCoverKey?.endsWith(".png"), "Create event did not persist its cover image");

  const url = `${base}/organizer/${eventId}`;
  const loadPage = async (step = 1) => (await fetch(`${url}?step=${step}`, { headers: { cookie } })).text();
  const submit = async (html, values = {}) => fetch(url, {
    method: "POST",
    headers: { cookie, origin: base },
    body: formDataFrom(html, values),
    redirect: "manual",
  });

  let html = await loadPage();
  const settingsForm = formsFrom(html).find((form) => form.includes('name="deadlineDate"'));
  ensure(settingsForm, "Event settings form missing");
  response = await submit(settingsForm, {
    title: event.title,
    description: "Temporary event",
    location: "Test room",
    eventType: "MIXED",
    deadlineDate: "2031-12-31",
    autoApprove: "on",
    coverImage: new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p7sAAAAASUVORK5CYII=", "base64")], "cover.png", { type: "image/png" }),
  });
  ensure(response.status === 303, "Save event settings did not redirect");
  const settings = await db.event.findUniqueOrThrow({ where: { id: eventId } });
  ensure(settings.eventType === "MIXED" && settings.autoApprove && settings.registrationDeadline?.toISOString() === "2031-12-31T16:59:59.999Z", "Event settings were not saved");
  ensure(settings.coverImageKey?.endsWith(".png") && settings.coverImageUrl === `/events/${event.slug}/cover`, "Local cover metadata was not saved");
  coverKey = settings.coverImageKey;
  const draftCover = await fetch(`${base}${settings.coverImageUrl}`, { headers: { cookie } });
  ensure(draftCover.status === 200 && draftCover.headers.get("cache-control") === "private, no-store" && (await draftCover.arrayBuffer()).byteLength > 8, "Draft cover was not served privately to an organizer");
  html = await loadPage(1);
  const updatedSettingsForm = formsFrom(html).find((form) => form.includes('name="coverImage"'));
  ensure(updatedSettingsForm, "Cover input missing from settings");
  response = await submit(updatedSettingsForm, { title: event.title, description: "Temporary event", location: "Test room", eventType: "MIXED", deadlineDate: "2031-12-31", autoApprove: "on", coverImage: new File(["not an image"], "invalid.png", { type: "image/png" }) });
  ensure(response.status === 303 && response.headers.get("location")?.includes("error=invalid-cover"), "Invalid cover was not rejected");
  ensure((await db.event.findUniqueOrThrow({ where: { id: eventId } })).coverImageKey === coverKey, "Invalid cover replaced the previous image");

  html = await loadPage(3);
  const addFieldForm = formsFrom(html).find((form) => form.includes('name="optionsText"'));
  ensure(addFieldForm, "Add field form missing");
  response = await submit(addFieldForm, { label: "หน่วยงาน", type: "select", optionsText: "แพทย์\nพยาบาล", required: "on" });
  ensure(response.status === 303, "Add field did not redirect");
  let fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  ensure(Array.isArray(fields) && fields.length === 1 && fields[0].required && fields[0].options.length === 2, "Registration field was not saved");

  response = await submit(addFieldForm, { label: "ตัวเลือกผิด", type: "select", optionsText: "ค่าเดียว" });
  ensure(response.headers.get("location")?.includes("invalid-options"), "Invalid select options were not rejected");

  response = await submit(addFieldForm, { label: "เบอร์โทร", type: "tel", optionsText: "" });
  ensure(response.status === 303, "Second field was not added");
  html = await loadPage(3);
  const editFieldForm = formsFrom(html).find((form) => form.includes("บันทึกฟิลด์"));
  ensure(editFieldForm, "Edit field form missing");
  response = await submit(editFieldForm, { label: "หน่วยงานใหม่", optionsText: "แพทย์\nพยาบาล\nอื่น ๆ", required: "on" });
  ensure(response.status === 303, "Field edit failed");
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  ensure(fields[0].label === "หน่วยงานใหม่" && fields[0].options.length === 3, "Edited field values were not saved");

  html = await loadPage(3);
  const moveForms = formsFrom(html).filter((form) => form.includes(">↑</button>"));
  ensure(moveForms.length === 2, "Reorder controls missing");
  response = await submit(moveForms[1]);
  ensure(response.status === 303, "Field reorder failed");
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  ensure(fields[0].label === "เบอร์โทร", "Field reorder was not saved");

  html = await loadPage(3);
  let removeFieldForm = formsFrom(html).find((form) => form.includes("ลบฟิลด์"));
  ensure(removeFieldForm, "Remove field form missing");
  response = await submit(removeFieldForm);
  ensure(response.status === 303, "Remove field did not redirect");
  html = await loadPage(3);
  removeFieldForm = formsFrom(html).find((form) => form.includes("ลบฟิลด์"));
  response = await submit(removeFieldForm);
  ensure(response.status === 303, "Second field removal failed");
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  ensure(Array.isArray(fields) && fields.length === 0, "Registration field was not removed");

  html = await loadPage(2);
  let addDayForm = formsFrom(html).find((form) => form.includes('name="maxSeats"'));
  ensure(addDayForm, "Add day form missing");

  response = await submit(addDayForm, { dates: ["2032-01-15", "2032-01-16"], maxSeats: "25" });
  ensure(response.status === 303, "Add multiple days did not redirect");
  const day = await db.eventDay.findUniqueOrThrow({
    where: { eventId_date: { eventId, date: new Date("2032-01-15T00:00:00.000Z") } },
  });
  const secondDay = await db.eventDay.findUniqueOrThrow({
    where: { eventId_date: { eventId, date: new Date("2032-01-16T00:00:00.000Z") } },
  });
  ensure(day.maxSeats === 25 && secondDay.maxSeats === 25, "Multiple day seats were not saved");

  response = await submit(addDayForm, { dates: ["2032-01-15", "2032-01-17"], maxSeats: "25" });
  ensure(response.headers.get("location")?.includes("duplicate-day"), "Duplicate date was not rejected");
  ensure(await db.eventDay.count({ where: { eventId, date: new Date("2032-01-17T00:00:00.000Z") } }) === 0, "Duplicate batch did not roll back");
  response = await submit(addDayForm, { dates: ["2032-01-18", "2032-02-30"], maxSeats: "25" });
  ensure(response.headers.get("location")?.includes("invalid-day"), "Impossible date was not rejected");
  ensure(await db.eventDay.count({ where: { eventId, date: new Date("2032-01-18T00:00:00.000Z") } }) === 0, "Invalid batch was partially saved");

  html = await loadPage(4);
  const addSessionForm = formsFrom(html).find((form) => form.includes("เพิ่มรอบ"));
  ensure(addSessionForm, "Add session form missing");
  response = await submit(addSessionForm, { label: "รอบเช้า", scope: day.id });
  ensure(response.status === 303, "Add day-bound session did not redirect");
  const session = await db.session.findFirstOrThrow({ where: { eventId, eventDayId: day.id, label: "รอบเช้า" } });

  html = await loadPage(4);
  const removeSessionForm = formsFrom(html).find((form) => form.includes("ลบรอบ"));
  ensure(removeSessionForm, "Remove session form missing");
  response = await submit(removeSessionForm);
  ensure(response.status === 303, "Remove session did not redirect");
  ensure(await db.session.count({ where: { id: session.id } }) === 0, "Session was not removed");

  html = await loadPage(4);
  const globalSessionForm = formsFrom(html).find((form) => form.includes('name="scope"'));
  ensure(globalSessionForm, "Global session form missing");
  response = await submit(globalSessionForm, { label: "รอบทุกวัน", scope: "EVENT" });
  ensure(response.status === 303, "Add global session did not redirect");
  const globalSession = await db.session.findFirstOrThrow({ where: { eventId, eventDayId: null, label: "รอบทุกวัน" } });
  const checkInHtml = await (await fetch(`${base}/check-in/${eventId}`, { headers: { cookie } })).text();
  ensure(checkInHtml.includes(globalSession.label) && checkInHtml.includes("ทุกวัน"), "Global session did not appear as an all-days option in check-in");
  html = await loadPage(4);
  const removeGlobalSessionForm = formsFrom(html).find((form) => form.includes("ลบรอบ"));
  ensure(removeGlobalSessionForm, "Remove global session form missing");
  response = await submit(removeGlobalSessionForm);
  ensure(response.status === 303 && await db.session.count({ where: { id: globalSession.id } }) === 0, "Remove global session failed");

  html = await loadPage(2);
  const removeDayForm = formsFrom(html).find((form) => form.includes("ลบวัน"));
  ensure(removeDayForm, "Remove day form missing");
  response = await submit(removeDayForm);
  ensure(response.status === 303, "Remove day did not redirect");
  ensure(await db.eventDay.count({ where: { id: day.id } }) === 0, "Day was not removed");

  const auditCount = await db.auditLog.count({ where: { eventId, actorId: admin.id } });
  ensure(auditCount === 14, `Expected 14 admin audit entries, got ${auditCount}`);

  const publicPage = await (await fetch(`${base}/events/${event.slug}`)).text();
  ensure(publicPage.includes("ยังไม่เปิดรับลงทะเบียน") && publicPage.includes(event.title) && !publicPage.includes("Temporary event") && !publicPage.includes("Test room"), "Draft public gate exposed more than the event title");

  await db.event.update({ where: { id: eventId }, data: { status: "PUBLISHED" } });
  const publicCover = await fetch(`${base}${settings.coverImageUrl}`);
  ensure(publicCover.status === 200 && publicCover.headers.get("content-type") === "image/png", "Published cover was not publicly served");
  const publishedPage = await (await fetch(`${base}/events/${event.slug}`)).text();
  ensure(publishedPage.includes(event.title) && publishedPage.includes("ยังไม่พร้อมรับลงทะเบียนออนไลน์"), "Published event details were not shown correctly");

  await db.event.update({ where: { id: eventId }, data: { status: "CLOSED" } });
  const closedPage = await (await fetch(`${base}/events/${event.slug}`)).text();
  ensure(closedPage.includes("ปิดรับลงทะเบียนแล้ว"), "Closed event did not show the closed state");

  process.stdout.write("Event settings, fields, schedule, admin audit, and public status gates passed.\n");
} finally {
  if (eventId) {
    await db.auditLog.deleteMany({ where: { eventId } });
    await db.event.delete({ where: { id: eventId } });
  }
  if (createdEventId) await db.event.delete({ where: { id: createdEventId } });
  if (coverKey) { try { await unlink(join(process.cwd(), ".local-uploads", coverKey)); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  if (createdCoverKey) { try { await unlink(join(process.cwd(), ".local-uploads", createdCoverKey)); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  if (ownerId) await db.user.delete({ where: { id: ownerId } });
  await db.$disconnect();
}
