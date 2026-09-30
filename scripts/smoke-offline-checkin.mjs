// Offline and multi-device check-in (PROGRESS.md §C): drives the real check-in page in Chrome against the running app
// (default http://localhost:3100) and checks the offline queue rules from spec §3.
//
//   node scripts/smoke-offline-checkin.mjs
//
// Scenarios: queue while offline then sync with the real scan time · same person checked from another device while
// offline · person revoked while offline · session deleted while offline · response lost after the server saved ·
// switching staff accounts on one device · beforeunload warning · five devices scanning one person at once.
// Needs a local Chrome (CHROME_PATH) and the seeded staff accounts; test data is created and removed by the script.
import { createHash, randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = process.env.BASE_URL ?? "http://localhost:3100";
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const password = process.env.CHECK_PASSWORD ?? "CheckInHub123!";
const suffix = randomUUID().slice(0, 8);
const hash = (token) => createHash("sha256").update(token).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ensure(condition, message) { if (!condition) throw new Error(message); }
async function waitFor(check, message, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out: ${message}`);
    await sleep(250);
  }
}

/** Items in the device's offline queue (IndexedDB), without decrypting them. */
const queued = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open("checkinhub-checkin-queue-v1", 1);
  open.onupgradeneeded = () => { open.result.createObjectStore("scans", { keyPath: "id" }); open.result.createObjectStore("keys"); };
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const database = open.result;
    const all = database.transaction("scans").objectStore("scans").getAll();
    all.onsuccess = () => { database.close(); resolve(all.result.map((scan) => ({ id: scan.id, operatorId: scan.operatorId, error: scan.lastError ?? null, queuedAt: scan.queuedAt }))); };
    all.onerror = () => reject(all.error);
  };
}));

const activeCheckIns = (registrantId, sessionId) => db.checkIn.findMany({ where: { registrantId, sessionId, voidedAt: null } });

async function seed() {
  const [admin, organizer] = await Promise.all(["admin@checkinhub.local", "organizer@checkinhub.local"].map((email) => db.user.findUniqueOrThrow({ where: { email }, select: { id: true } })));
  const event = await db.event.create({ data: {
    slug: `offline-smoke-${suffix}`, title: "Offline check-in smoke", ownerId: admin.id, status: "PUBLISHED",
    registrationDeadline: new Date("2031-12-30T16:59:59.999Z"),
    fields: [{ key: "name", label: "ชื่อ", type: "text", required: true, showOnCheckin: true }],
    days: { create: [{ date: new Date("2031-12-31T00:00:00Z"), maxSeats: 50 }] },
    organizers: { create: [{ userId: organizer.id, role: "FULL" }] },
  } });
  const day = await db.eventDay.findFirstOrThrow({ where: { eventId: event.id } });
  const main = await db.session.create({ data: { eventId: event.id, eventDayId: day.id, label: "เช้า", sortOrder: 1 } });
  const doomed = await db.session.create({ data: { eventId: event.id, eventDayId: day.id, label: "บ่าย", sortOrder: 2 } });
  const people = [];
  for (let index = 0; index < 8; index++) {
    const code = `offline-${suffix}-${index}-${randomUUID()}`;
    people.push({ code, ...await db.registrant.create({ data: {
      eventId: event.id, email: `offline-${index}-${suffix}@example.invalid`, dedupeKey: `offline-${index}-${suffix}@example.invalid`,
      status: "APPROVED", approvedAt: new Date(), qrCode: code, statusTokenHash: hash(`offline-${suffix}-${index}`), consentedAt: new Date(),
      answers: { name: `ออฟไลน์ ${index}` }, displayName: `ออฟไลน์ ${index}`,
      days: { create: [{ eventDayId: day.id, status: "APPROVED" }] },
    } }) });
  }
  return { event, main, doomed, people, admin, organizer };
}

async function login(context, email) {
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.close();
}

async function openCheckIn(context, eventId, sessionId) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message.split("\n")[0]));
  page.errors = errors;
  await page.goto(`${base}/check-in/${eventId}?session=${sessionId}`, { waitUntil: "load" });
  await page.waitForSelector("#scan-code");
  // Let hydration finish so the form's client-side submit handler is attached.
  await page.waitForTimeout(800);
  return page;
}

async function scan(page, code) {
  await page.fill("#scan-code", code);
  await page.press("#scan-code", "Enter");
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);
const results = [];
async function scenario(name, run) {
  const started = Date.now();
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`✓ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`✗ ${name}\n  ${error.message}`);
  }
}

const browser = await chromium.launch({ executablePath: chromePath });
const fixture = await seed();
const { event, main, doomed, people, admin, organizer } = fixture;
const viewport = { width: 1440, height: 900 };
try {
  const deviceA = await browser.newContext({ viewport });
  const deviceB = await browser.newContext({ viewport });
  await login(deviceA, "admin@checkinhub.local");
  await login(deviceB, "organizer@checkinhub.local");
  const adminState = await deviceA.storageState();
  let pageA = await openCheckIn(deviceA, event.id, main.id);

  await scenario("1. เน็ตหลุด: สแกนแล้วเก็บในเครื่อง ต่อเน็ตแล้วซิงก์เอง ใช้เวลาที่สแกนจริง", async () => {
    const [person] = people;
    await deviceA.setOffline(true);
    const before = Date.now();
    await scan(pageA, person.code);
    await waitFor(async () => (await queued(pageA)).length === 1, "scan queued in IndexedDB");
    ensure((await bodyText(pageA)).includes("บันทึกไว้ในเครื่อง"), "queued result not shown");
    ensure((await activeCheckIns(person.id, main.id)).length === 0, "saved on the server while offline");
    await sleep(2000);
    await deviceA.setOffline(false);
    const [row] = await waitFor(async () => { const rows = await activeCheckIns(person.id, main.id); return rows.length ? rows : null; }, "check-in synced");
    ensure(row.clientEventId, "synced row has no clientEventId");
    ensure(row.checkedInById === admin.id, "synced row has the wrong operator");
    ensure(Math.abs(row.checkedInAt.getTime() - before) < 1500, `checkedInAt is not the scan time (${row.checkedInAt.toISOString()})`);
    ensure(row.syncedAt.getTime() - row.checkedInAt.getTime() >= 1500, "syncedAt does not show the later sync");
    await waitFor(async () => (await queued(pageA)).length === 0, "queue emptied after sync");
  });

  await scenario("2. คนเดียวกันถูกเช็คจากอีกเครื่องระหว่างออฟไลน์ → ไม่บันทึกซ้ำ แจ้งว่าเช็คจากเครื่องอื่นแล้ว", async () => {
    const person = people[1];
    await deviceA.setOffline(true);
    await scan(pageA, person.code);
    await waitFor(async () => (await queued(pageA)).length === 1, "scan queued");
    const pageB = await openCheckIn(deviceB, event.id, main.id);
    await scan(pageB, person.code);
    await waitFor(async () => (await activeCheckIns(person.id, main.id)).length === 1, "device B check-in saved");
    await deviceA.setOffline(false);
    await waitFor(async () => (await queued(pageA)).length === 0, "queue emptied");
    await waitFor(async () => (await bodyText(pageA)).includes("มีการเช็คจากเครื่องอื่นแล้ว"), "'checked from another device' message");
    const rows = await activeCheckIns(person.id, main.id);
    ensure(rows.length === 1 && rows[0].checkedInById === organizer.id, "duplicate or wrong check-in after sync");
    await pageB.close();
  });

  await scenario("3. ถูกยกเลิกระหว่างออฟไลน์ → ไม่บันทึก ขึ้นรายการต้องตรวจสอบ และลบรายการได้", async () => {
    const person = people[2];
    await deviceA.setOffline(true);
    await scan(pageA, person.code);
    await waitFor(async () => (await queued(pageA)).length === 1, "scan queued");
    await db.$transaction([
      db.registrant.update({ where: { id: person.id }, data: { status: "CANCELLED", cancelledAt: new Date(), qrCode: null, dedupeKey: null } }),
      db.registrantEventDay.updateMany({ where: { registrantId: person.id }, data: { status: "CANCELLED" } }),
    ]);
    await deviceA.setOffline(false);
    await waitFor(async () => (await queued(pageA)).some((item) => item.error === "invalid"), "item marked for review");
    await waitFor(async () => (await bodyText(pageA)).includes("ต้องตรวจสอบ — ยังไม่ได้เช็คชื่อ"), "review list shown");
    ensure((await activeCheckIns(person.id, main.id)).length === 0, "revoked person was checked in");
    pageA.once("dialog", (dialog) => dialog.accept());
    await pageA.getByRole("button", { name: "ลบรายการที่ตรวจไม่ผ่าน" }).click();
    await waitFor(async () => (await queued(pageA)).length === 0, "review item discarded");
  });

  await scenario("4. รอบถูกลบระหว่างออฟไลน์ → ไม่บันทึก ขึ้นรายการต้องตรวจสอบ", async () => {
    const person = people[3];
    const pageDoomed = await openCheckIn(deviceA, event.id, doomed.id);
    await deviceA.setOffline(true);
    await scan(pageDoomed, person.code);
    await waitFor(async () => (await queued(pageDoomed)).length === 1, "scan queued");
    await db.session.delete({ where: { id: doomed.id } });
    await deviceA.setOffline(false);
    await waitFor(async () => (await queued(pageDoomed)).some((item) => item.error === "session-missing"), "item marked session-missing");
    ensure(await db.checkIn.count({ where: { registrantId: person.id } }) === 0, "check-in saved for a deleted session");
    await pageDoomed.close({ runBeforeUnload: false });
    // The review item stays on the device until staff discard it from any session of the event.
    await pageA.reload();
    await pageA.waitForSelector("#scan-code");
    await waitFor(async () => (await bodyText(pageA)).includes("รอบที่ถูกลบแล้ว"), "review item labelled as a deleted session");
    pageA.once("dialog", (dialog) => dialog.accept());
    await pageA.getByRole("button", { name: "ลบรายการที่ตรวจไม่ผ่าน" }).click();
    await waitFor(async () => (await queued(pageA)).length === 0, "review item discarded");
  });

  await scenario("5. เซิร์ฟเวอร์บันทึกแล้วแต่คำตอบหายระหว่างทาง → ส่งซ้ำแล้วไม่เกิดรายการซ้ำ", async () => {
    const person = people[4];
    let dropped = 0;
    await pageA.route("**/check-in/**", async (route) => {
      const request = route.request();
      if (dropped || request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
      dropped++;
      await route.fetch();
      await route.abort("failed");
    });
    await scan(pageA, person.code);
    await waitFor(async () => (await activeCheckIns(person.id, main.id)).length === 1, "server saved the first attempt");
    const [item] = await waitFor(async () => { const items = await queued(pageA); return items.length === 1 ? items : null; }, "client queued after the lost response");
    const [saved] = await activeCheckIns(person.id, main.id);
    ensure(item.id === saved.clientEventId, "the queue did not keep the id of the lost request");
    await pageA.unroute("**/check-in/**");
    await deviceA.setOffline(true);
    await deviceA.setOffline(false);
    await waitFor(async () => (await queued(pageA)).length === 0, "queue emptied after retry");
    ensure((await activeCheckIns(person.id, main.id)).length === 1, "retry created a second check-in");
    await waitFor(async () => (await bodyText(pageA)).includes("ซิงก์เช็คชื่อสำเร็จ 1 รายการ"), "retry reported as synced");
    ensure(!(await bodyText(pageA)).includes("เครื่องอื่น"), "retry of our own scan reported as another device's check-in");
  });

  await scenario("6. เตือนก่อนปิดหน้าเมื่อยังมีรายการค้างในเครื่อง (beforeunload)", async () => {
    const person = people[5];
    await deviceA.setOffline(true);
    await scan(pageA, person.code);
    await waitFor(async () => (await queued(pageA)).length === 1, "scan queued");
    // The warning is armed from the on-screen pending count, which updates just after the IndexedDB write.
    await waitFor(async () => (await bodyText(pageA)).includes("รอ sync"), "pending banner shown");
    const dialog = new Promise((resolve) => pageA.once("dialog", async (item) => { resolve(item.type()); await item.accept(); }));
    const closed = pageA.waitForEvent("close");
    // With runBeforeUnload the call returns before the page is gone; wait for the real close after accepting.
    await pageA.close({ runBeforeUnload: true });
    ensure(await Promise.race([dialog, sleep(5000).then(() => "none")]) === "beforeunload", "no beforeunload warning with unsynced scans");
    await closed;
  });

  await scenario("7. สลับบัญชีเจ้าหน้าที่บนเครื่องเดียวกัน → รายการของคนเดิมไม่หาย ซิงก์เมื่อคนเดิมกลับมา", async () => {
    const person = people[5]; // queued by admin in scenario 6, still on device A
    await deviceA.clearCookies();
    await deviceA.setOffline(false);
    await login(deviceA, "organizer@checkinhub.local");
    const other = await openCheckIn(deviceA, event.id, main.id);
    await sleep(2500);
    const items = await queued(other);
    ensure(items.length === 1 && items[0].operatorId === admin.id, "admin's queued scan was lost or reassigned");
    ensure((await activeCheckIns(person.id, main.id)).length === 0, "another account synced the admin's scan");
    await waitFor(async () => (await bodyText(other)).includes("รายการสแกนของบัญชีเจ้าหน้าที่อื่นค้างอยู่ 1 รายการ"), "other account's pending scans are announced");
    await other.close();
    await deviceA.clearCookies();
    await login(deviceA, "admin@checkinhub.local");
    pageA = await openCheckIn(deviceA, event.id, main.id);
    const [row] = await waitFor(async () => { const rows = await activeCheckIns(person.id, main.id); return rows.length ? rows : null; }, "admin's scan synced after logging back in");
    ensure(row.checkedInById === admin.id, "synced under the wrong operator");
    await waitFor(async () => (await queued(pageA)).length === 0, "queue emptied");
    ensure(!(await bodyText(pageA)).includes("บัญชีเจ้าหน้าที่อื่นค้างอยู่"), "banner still shown after the scans synced");
  });

  await scenario("8. ห้าเครื่องสแกนคนเดียวกันพร้อมกัน → บันทึกครั้งเดียว", async () => {
    const person = people[6];
    const devices = await Promise.all(Array.from({ length: 5 }, () => browser.newContext({ viewport, storageState: adminState })));
    const pages = await Promise.all(devices.map((device) => openCheckIn(device, event.id, main.id)));
    await Promise.all(pages.map((page) => scan(page, person.code)));
    await waitFor(async () => {
      const texts = await Promise.all(pages.map(bodyText));
      return texts.every((text) => text.includes("เช็คชื่อสำเร็จ") || text.includes("เช็คซ้ำ"));
    }, "every device shows a result");
    const texts = await Promise.all(pages.map(bodyText));
    const successes = texts.filter((text) => text.includes("เช็คชื่อสำเร็จ")).length;
    ensure((await activeCheckIns(person.id, main.id)).length === 1, "more than one active check-in");
    ensure(successes === 1, `${successes} devices showed success`);
    ensure(pages.every((page) => page.errors.length === 0), `page errors: ${pages.flatMap((page) => page.errors).join(" | ")}`);
    await Promise.all(devices.map((device) => device.close()));
  });

  ensure([pageA].every((page) => page.isClosed() || page.errors.length === 0), `page errors: ${pageA.errors.join(" | ")}`);
} finally {
  await browser.close();
  await db.event.delete({ where: { id: event.id } }).catch(() => undefined);
  await db.$disconnect();
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
process.exit(failed ? 1 : 0);
