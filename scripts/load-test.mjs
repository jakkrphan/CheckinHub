// Load test (PROGRESS.md §C): many registrations at once, then several check-in devices scanning at full speed.
// Run it against a production build, not `next dev` (dev compiles on demand and its timings mean nothing):
//
//   npm run build && npx next start -p 3200
//   BASE_URL=http://localhost:3200 node scripts/load-test.mjs
//   node scripts/load-test.mjs --registrations=2000 --concurrency=100 --devices=10 --checkins=1500
//
// Checks: every submit answered, no day or course over its seats, the waitlist takes the rest, every scan saved once.
// Reports latency (p50/p95/max) and throughput. Test data is created and removed by the script.
import { createHash, randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = process.env.BASE_URL ?? "http://localhost:3200";
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, value] = arg.replace(/^--/, "").split("="); return [key, value ?? true]; }));
const registrations = Number(args.registrations ?? 1000);
const concurrency = Number(args.concurrency ?? 50);
const devices = Number(args.devices ?? 8);
const checkins = Number(args.checkins ?? 1000);
const suffix = randomUUID().slice(0, 8);
const hash = (token) => createHash("sha256").update(token).digest("hex");
const createdEvents = [];
const usedIps = [];
const usedIp = (ip) => { usedIps.push(ip); return ip; };
let failures = 0;

function check(condition, message) {
  console.log(`  ${condition ? "✓" : "✗"} ${message}`);
  if (!condition) failures++;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return `p50 ${Math.round(at(0.5))} ms · p95 ${Math.round(at(0.95))} ms · max ${Math.round(sorted.at(-1) ?? 0)} ms`;
}

/** Runs `task(i)` for i in [0, count) with at most `limit` in flight. */
async function pool(count, limit, task) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, count) }, async () => {
    while (next < count) await task(next++);
  }));
}

function formDataFrom(html, values) {
  const form = new FormData();
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) {
    form.set(match[1], (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  }
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) for (const item of value) form.append(name, item);
    else form.set(name, value);
  }
  return form;
}

async function registrationForm(slug) {
  const url = `${base}/events/${slug}`;
  const html = await (await fetch(url)).text();
  const form = html.split("<form").slice(1).map((part) => `<form${part.split("</form>")[0]}</form>`).find((part) => part.includes('name="consent"'));
  if (!form) throw new Error(`Registration form missing on ${url}`);
  // The server refuses forms submitted less than 3 seconds after rendering.
  await new Promise((resolve) => setTimeout(resolve, 3100));
  return { url, form };
}

async function submitMany(label, slug, count, valuesFor) {
  const { url, form } = await registrationForm(slug);
  const latencies = [];
  const outcomes = {};
  const started = performance.now();
  await pool(count, concurrency, async (index) => {
    const begin = performance.now();
    let outcome;
    try {
      const response = await fetch(url, {
        method: "POST", redirect: "manual",
        // One address per person, as on the real internet; the per-IP limit is 10 per 10 minutes.
        headers: { origin: base, "x-forwarded-for": usedIp(`load-${suffix}-${label}-${index}`) },
        body: formDataFrom(form, valuesFor(index)),
      });
      const location = response.headers.get("location") ?? "";
      outcome = response.status === 303 && location.includes("/status/") ? "ok" : `${response.status} ${location.split("?")[1] ?? ""}`.trim();
    } catch (error) {
      outcome = `network ${error.cause?.code ?? error.message}`;
    }
    latencies.push(performance.now() - begin);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  });
  const seconds = (performance.now() - started) / 1000;
  console.log(`  ${count} submits, ${concurrency} at a time: ${seconds.toFixed(1)} s (${(count / seconds).toFixed(1)}/s) · ${stats(latencies)}`);
  check(outcomes.ok === count, `every submit answered with the status page (${Object.entries(outcomes).map(([key, value]) => `${key}: ${value}`).join(", ")})`);
}

async function perDayRegistrations(owner) {
  console.log(`\n■ สมัครพร้อมกัน — แยกรายวัน (3 วัน × 100 ที่, รออนุมัติ, ${registrations} คน)`);
  const event = await db.event.create({ data: {
    slug: `load-perday-${suffix}`, title: "Load test · per day", ownerId: owner.id, status: "PUBLISHED", autoApprove: false, waitlistEnabled: true,
    registrationDeadline: new Date("2031-12-30T16:59:59.999Z"),
    fields: [{ key: "name", label: "ชื่อ", type: "text", required: true, showOnCheckin: true }, { key: "org", label: "หน่วยงาน", type: "select", required: true, options: ["ก", "ข", "ค"] }],
    days: { create: [1, 2, 3].map((day) => ({ date: new Date(`2031-12-0${day}T00:00:00Z`), maxSeats: 100 })) },
  } });
  createdEvents.push(event.id);
  const days = await db.eventDay.findMany({ where: { eventId: event.id }, orderBy: { date: "asc" } });
  // Everyone wants day 1; two in three also pick day 2 and one in three day 3, so every day overflows.
  const picks = (index) => [days[0].id, ...(index % 3 !== 0 ? [days[1].id] : []), ...(index % 3 === 2 ? [days[2].id] : [])];
  await submitMany("perday", event.slug, registrations, (index) => ({
    email: `load-${index}-${suffix}@example.invalid`, dayId: picks(index), "answer:name": `ผู้ทดสอบโหลด ${index}`, "answer:org": ["ก", "ข", "ค"][index % 3], consent: "on",
  }));
  for (const [index, day] of days.entries()) {
    const rows = await db.registrantEventDay.groupBy({ by: ["status"], where: { eventDayId: day.id }, _count: true });
    const count = (status) => rows.find((row) => row.status === status)?._count ?? 0;
    const wanted = Array.from({ length: registrations }, (_, person) => picks(person)).filter((ids) => ids.includes(day.id)).length;
    const held = count("PENDING") + count("APPROVED");
    check(held === Math.min(100, wanted) && count("WAITLISTED") === wanted - held, `วันที่ ${index + 1}: จองที่ ${held}/100, คิว ${count("WAITLISTED")} (ต้องการ ${wanted})`);
  }
  check(await db.registrant.count({ where: { eventId: event.id } }) === registrations, "one registrant per submit, no duplicates");
  return event;
}

async function wholeCourseRegistrations(owner) {
  const count = Math.ceil(registrations / 2);
  const seats = Math.ceil(count * 0.4);
  console.log(`\n■ สมัครพร้อมกัน — หลักสูตรต่อเนื่อง (${seats} ที่, อนุมัติอัตโนมัติ, ${count} คน)`);
  const event = await db.event.create({ data: {
    slug: `load-course-${suffix}`, title: "Load test · whole course", ownerId: owner.id, status: "PUBLISHED", autoApprove: true, waitlistEnabled: true,
    seatMode: "whole_course", maxSeats: seats, registrationDeadline: new Date("2031-12-30T16:59:59.999Z"),
    fields: [{ key: "name", label: "ชื่อ", type: "text", required: true }],
    days: { create: [1, 2, 3, 4, 5].map((day) => ({ date: new Date(`2031-12-1${day}T00:00:00Z`) })) },
  } });
  createdEvents.push(event.id);
  await submitMany("course", event.slug, count, (index) => ({ email: `course-${index}-${suffix}@example.invalid`, "answer:name": `หลักสูตร ${index}`, consent: "on" }));
  const rows = await db.registrant.groupBy({ by: ["status"], where: { eventId: event.id }, _count: true });
  const byStatus = (status) => rows.find((row) => row.status === status)?._count ?? 0;
  check(byStatus("APPROVED") === seats && byStatus("WAITLISTED") === count - seats, `อนุมัติ ${byStatus("APPROVED")}/${seats}, คิว ${byStatus("WAITLISTED")}`);
  check(await db.registrant.count({ where: { eventId: event.id, status: "APPROVED", qrCode: { not: null } } }) === seats, "every approved person has a QR");
  const dayRows = await db.registrantEventDay.count({ where: { eventDay: { eventId: event.id } } });
  check(dayRows === count * 5, `แถวรายวันครบ ${dayRows}/${count * 5} (ทุกคนมีครบ 5 วัน)`);
}

async function checkInLoad(owner) {
  const perDevice = Math.ceil(checkins / devices);
  console.log(`\n■ เช็คชื่อพร้อมกัน — ${devices} เครื่อง × ${perDevice} คน (สแกนต่อเนื่องไม่เว้นช่วง)`);
  const event = await db.event.create({ data: {
    slug: `load-checkin-${suffix}`, title: "Load test · check-in", ownerId: owner.id, status: "PUBLISHED",
    registrationDeadline: new Date("2031-12-30T16:59:59.999Z"),
    fields: [{ key: "name", label: "ชื่อ", type: "text", required: true, showOnCheckin: true }],
    days: { create: [{ date: new Date("2031-12-20T00:00:00Z"), maxSeats: checkins }] },
  } });
  createdEvents.push(event.id);
  const day = await db.eventDay.findFirstOrThrow({ where: { eventId: event.id } });
  const session = await db.session.create({ data: { eventId: event.id, eventDayId: day.id, label: "เช้า", sortOrder: 1 } });
  const people = Array.from({ length: checkins }, (_, index) => ({ id: `load${suffix}${String(index).padStart(5, "0")}`, code: `load-${suffix}-${index}-${randomUUID()}` }));
  for (let start = 0; start < people.length; start += 500) {
    const batch = people.slice(start, start + 500);
    await db.registrant.createMany({ data: batch.map((person, offset) => ({
      id: person.id, eventId: event.id, email: `checkin-${start + offset}-${suffix}@example.invalid`, dedupeKey: `checkin-${start + offset}-${suffix}@example.invalid`,
      status: "APPROVED", approvedAt: new Date(), qrCode: person.code, statusTokenHash: hash(person.code), consentedAt: new Date(),
      answers: { name: `ผู้เข้าอบรม ${start + offset}` }, displayName: `ผู้เข้าอบรม ${start + offset}`,
    })) });
    await db.registrantEventDay.createMany({ data: batch.map((person) => ({ registrantId: person.id, eventDayId: day.id, status: "APPROVED" })) });
  }

  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const login = await browser.newContext();
    const loginPage = await login.newPage();
    await loginPage.goto(`${base}/login`);
    await loginPage.fill('input[name="email"]', "admin@checkinhub.local");
    await loginPage.fill('input[name="password"]', process.env.CHECK_PASSWORD ?? "CheckInHub123!");
    await loginPage.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await loginPage.waitForURL((url) => !url.pathname.startsWith("/login"));
    const state = await login.storageState();
    await login.close();

    const contexts = await Promise.all(Array.from({ length: devices }, () => browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state })));
    const pages = await Promise.all(contexts.map(async (context) => {
      const page = await context.newPage();
      page.errors = [];
      page.on("pageerror", (error) => page.errors.push(error.message.split("\n")[0]));
      await page.goto(`${base}/check-in/${event.id}?session=${session.id}`);
      await page.waitForSelector("#scan-code");
      await page.waitForTimeout(800);
      return page;
    }));

    // Organizer pages opened during the rush, as someone watching the dashboard and the list would.
    const cookie = state.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
    const pageTimes = { dashboard: [], registrants: [] };
    let rush = true;
    const watcher = (async () => {
      while (rush) {
        for (const [name, path] of [["dashboard", "dashboard"], ["registrants", "registrants"]]) {
          const begin = performance.now();
          const response = await fetch(`${base}/organizer/${event.id}/${path}`, { headers: { cookie } });
          await response.text();
          if (response.ok) pageTimes[name].push(performance.now() - begin);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    })();

    const latencies = [];
    const kinds = {};
    const started = performance.now();
    await Promise.all(pages.map(async (page, deviceIndex) => {
      for (const person of people.slice(deviceIndex * perDevice, (deviceIndex + 1) * perDevice)) {
        const begin = performance.now();
        const answered = page.waitForResponse((response) => response.request().method() === "POST" && !!response.request().headers()["next-action"], { timeout: 30000 });
        await page.fill("#scan-code", person.code);
        await page.press("#scan-code", "Enter");
        let response;
        try { response = await answered; } catch { kinds.timeout = (kinds.timeout ?? 0) + 1; continue; }
        latencies.push(performance.now() - begin);
        // Chrome drops streamed server-action bodies before they can be read, so outcomes are checked in the database.
        const kind = response.ok() ? "answered" : `HTTP ${response.status()}`;
        kinds[kind] = (kinds[kind] ?? 0) + 1;
      }
    }));
    const seconds = (performance.now() - started) / 1000;
    rush = false;
    await watcher;

    console.log(`  ${latencies.length} scans in ${seconds.toFixed(1)} s (${(latencies.length / seconds).toFixed(1)} scans/s across ${devices} devices) · ${stats(latencies)}`);
    console.log(`  organizer pages during the rush: dashboard ${stats(pageTimes.dashboard)} · registrants ${stats(pageTimes.registrants)}`);
    check(kinds.answered === checkins, `every scan answered by the server (${Object.entries(kinds).map(([key, value]) => `${key}: ${value}`).join(", ")})`);
    const saved = await db.checkIn.count({ where: { sessionId: session.id, voidedAt: null } });
    const distinct = (await db.checkIn.groupBy({ by: ["registrantId"], where: { sessionId: session.id, voidedAt: null } })).length;
    check(saved === checkins && distinct === checkins, `saved ${saved} check-ins for ${distinct} people (expected ${checkins} each)`);
    check(pages.every((page) => page.errors.length === 0), `no page errors${pages.some((page) => page.errors.length) ? `: ${pages.flatMap((page) => page.errors).slice(0, 3).join(" | ")}` : ""}`);
  } finally {
    await browser.close();
  }
}

try {
  const health = await fetch(`${base}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`${base} is not answering /api/health — start the production server first`);
  const owner = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" }, select: { id: true } });
  console.log(`Load test against ${base}`);
  await perDayRegistrations(owner);
  await wholeCourseRegistrations(owner);
  await checkInLoad(owner);
} finally {
  if (createdEvents.length) await db.event.deleteMany({ where: { id: { in: createdEvents } } });
  // Only this run's rate-limit rows (hashed the same way as src/server/registrations/registration.ts).
  const ipHashes = usedIps.map((ip) => createHash("sha256").update(`${process.env.AUTH_SECRET}:${ip}`).digest("hex"));
  for (let start = 0; start < ipHashes.length; start += 1000) await db.registrationAttempt.deleteMany({ where: { ipHash: { in: ipHashes.slice(start, start + 1000) } } });
  await db.$disconnect();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
