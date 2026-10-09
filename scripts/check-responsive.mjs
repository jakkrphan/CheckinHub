// Responsive layout check: opens every page at every supported screen size against the running app
// (default http://localhost:3100) and reports layout problems.
//
//   node scripts/check-responsive.mjs                 # all pages × all sizes
//   node scripts/check-responsive.mjs --shots         # also save screenshots to .responsive/<size>/<page>.png
//   node scripts/check-responsive.mjs --only=check-in --sizes=320,390x844
//
// Errors (exit code 1): the page scrolls horizontally, or the page throws.
// Warnings: content hidden inside a horizontal scroller, tap targets < 24px (< 44px on check-in/kiosk),
// inputs with font-size < 16px on phones (iOS Safari zooms in on focus), and text squeezed into a narrow sliver.
// Needs a local Chrome (CHROME_PATH) and the dev database; test data is created and removed by the script.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = process.env.BASE_URL ?? "http://localhost:3100";
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, value] = arg.replace(/^--/, "").split("="); return [key, value ?? true]; }));

const allSizes = [
  { name: "320", width: 320, height: 640, mobile: true },
  { name: "360", width: 360, height: 740, mobile: true },
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "430", width: 430, height: 932, mobile: true },
  { name: "844x390", width: 844, height: 390, mobile: true },
  { name: "768", width: 768, height: 1024, mobile: true },
  { name: "1024", width: 1024, height: 768, mobile: true },
  { name: "1280", width: 1280, height: 800, mobile: false },
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "1920", width: 1920, height: 1080, mobile: false },
];
const sizes = args.sizes ? allSizes.filter((size) => String(args.sizes).split(",").includes(size.name)) : allSizes;
const hash = (token) => createHash("sha256").update(token).digest("hex");

async function seed() {
  const owner = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" }, select: { id: true } });
  await db.event.deleteMany({ where: { slug: { in: ["responsive-check", "responsive-check-draft"] } } });
  const fields = [
    { key: "name", label: "ชื่อ-นามสกุล", type: "text", required: true, showOnCheckin: true },
    { key: "kind", label: "ประเภทผู้เข้าร่วม", type: "select", required: true, options: ["ข้าราชการ", "พนักงานราชการ", "บุคคลทั่วไป"], showOnCheckin: true },
    { key: "org", label: "หน่วยงานต้นสังกัด (ชื่อเต็มตามคำสั่ง)", type: "text", required: true, conditional: { field: "kind", operator: "equals", value: "ข้าราชการ" } },
    { key: "note", label: "หมายเหตุ", type: "textarea", required: false },
    { key: "doc", label: "หนังสืออนุมัติเข้าร่วม", type: "file", required: false, acceptedFileTypes: ["pdf", "jpg"], maxFileSizeMb: 5 },
  ];
  const event = await db.event.create({ data: {
    slug: "responsive-check", ownerId: owner.id, status: "PUBLISHED", autoApprove: false, waitlistEnabled: true,
    // A long unbroken-ish title catches layouts that let text widen the page.
    title: "อบรมเชิงปฏิบัติการการใช้งานระบบสารสนเทศโรงพยาบาลสำหรับพยาบาลวิชาชีพที่เข้าปฏิบัติงานใหม่ ประจำปีงบประมาณ 2570 รุ่นที่ 3",
    description: "ทดสอบการแสดงผลทุกขนาดหน้าจอ", location: "ห้องประชุมใหญ่ ชั้น 9 อาคารเฉลิมพระเกียรติ 80 พรรษา",
    registrationDeadline: new Date("2031-12-30T16:59:59.999Z"), fields,
    days: { create: [{ date: new Date("2031-12-01T00:00:00Z"), maxSeats: 40 }, { date: new Date("2031-12-02T00:00:00Z"), maxSeats: 1 }, { date: new Date("2031-12-03T00:00:00Z") }, { date: new Date("2031-12-08T00:00:00Z"), maxSeats: 60 }] },
  } });
  const days = await db.eventDay.findMany({ where: { eventId: event.id }, orderBy: { date: "asc" } });
  let order = 1;
  for (const day of days) for (const label of ["เช้า", "บ่าย"]) await db.session.create({ data: { eventId: event.id, eventDayId: day.id, label, sortOrder: order++ } });
  await db.session.create({ data: { eventId: event.id, label: "รับของที่ระลึก", sortOrder: order++ } });
  const person = (email, token, status, dayStatuses) => db.registrant.create({ data: {
    eventId: event.id, email, dedupeKey: email, status, statusTokenHash: hash(token), consentedAt: new Date(), fieldsVersion: 1,
    answers: { name: `ทดสอบ ${email.split("@")[0]} นามสกุลยาวมากเป็นพิเศษ`, kind: "บุคคลทั่วไป" },
    qrCode: status === "APPROVED" ? `responsive-${token}` : null, approvedAt: status === "APPROVED" ? new Date() : null,
    days: { create: dayStatuses.map(([index, dayStatus]) => ({ eventDayId: days[index].id, status: dayStatus, waitlistedAt: dayStatus === "WAITLISTED" ? new Date() : null })) },
  } });
  const approved = await person("approved.person.with.long.address@example.invalid", "rc-approved", "APPROVED", [[0, "APPROVED"], [1, "APPROVED"], [3, "APPROVED"]]);
  await person("waiting@example.invalid", "rc-waitlist", "WAITLISTED", [[1, "WAITLISTED"]]);
  await person("pending@example.invalid", "rc-pending", "PENDING", [[0, "PENDING"]]);
  const draft = await db.event.create({ data: { slug: "responsive-check-draft", ownerId: owner.id, status: "DRAFT", title: "ฉบับร่างทดสอบการแสดงผล", fields: [] } });
  const session = await db.session.findFirstOrThrow({ where: { eventId: event.id }, orderBy: { sortOrder: "asc" } });
  return { event, draft, approved, session };
}

function pagesFor({ event, draft, approved, session }) {
  const id = event.id;
  return [
    { name: "public-register", path: `/events/${event.slug}` },
    { name: "public-status-approved", path: `/events/${event.slug}/status/rc-approved` },
    { name: "public-status-waitlist", path: `/events/${event.slug}/status/rc-waitlist` },
    { name: "public-change-days", path: `/events/${event.slug}/status/rc-approved/days` },
    { name: "public-edit", path: `/events/${event.slug}/status/rc-approved/edit` },
    { name: "public-draft", path: `/events/${draft.slug}` },
    { name: "login", path: "/login" },
    { name: "not-found", path: "/this-page-does-not-exist" },
    { name: "organizer-list", path: "/organizer", staff: true },
    { name: "organizer-new", path: "/organizer/new", staff: true },
    ...[1, 2, 3, 4, 5].map((step) => ({ name: `settings-step-${step}`, path: `/organizer/${id}?step=${step}`, staff: true })),
    { name: "settings-step-3-file", path: `/organizer/${id}?step=3&field=doc`, staff: true },
    { name: "dashboard", path: `/organizer/${id}/dashboard`, staff: true },
    { name: "registrants", path: `/organizer/${id}/registrants`, staff: true },
    { name: "registrant-detail", path: `/organizer/${id}/registrants?selected=${approved.id}`, staff: true },
    { name: "walk-in", path: `/organizer/${id}/registrants/new`, staff: true },
    { name: "walk-in-added", path: `/organizer/${id}/registrants/new?added=${approved.id}`, staff: true },
    { name: "qr-poster", path: `/organizer/${id}/poster`, staff: true },
    { name: "admin-users", path: "/admin", staff: true },
    { name: "admin-events", path: "/admin?view=events", staff: true },
    { name: "admin-audit", path: "/admin?view=audit", staff: true },
    { name: "admin-settings", path: "/admin?view=settings", staff: true },
    { name: "admin-requests", path: "/admin?view=requests&requests=all", staff: true },
    { name: "admin-event", path: `/admin/events/${id}`, staff: true },
    { name: "account-password", path: "/account/password", staff: true },
    { name: "check-in-list", path: "/check-in", staff: true },
    { name: "check-in", path: `/check-in/${id}?session=${session.id}`, staff: true, touch: true },
    ...(process.env.FEATURE_KIOSK === "true" ? [{ name: "kiosk", path: `/check-in/${id}/kiosk?session=${session.id}`, staff: true, touch: true }] : []),
  ].filter((page) => !args.only || page.name.includes(String(args.only)));
}

/** Runs in the page: collects layout problems at the current viewport. */
function inspect({ minTarget, mobile }) {
  const vw = document.documentElement.clientWidth;
  const visible = (element) => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && !element.closest(".sr-only, [aria-hidden='true'], [popover]:not(:popover-open), details:not([open]) > :not(summary)"); };
  const describe = (element) => { const text = (element.getAttribute("aria-label") || element.innerText || element.getAttribute("placeholder") || element.value || "").trim().replace(/\s+/g, " ").slice(0, 24); return `${element.tagName.toLowerCase()}${text ? ` "${text}"` : ""}`; };
  const scroller = (element) => { for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) { if (getComputedStyle(node).overflowX !== "visible") return node; } return null; };

  const pageOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
  const beyond = [...document.querySelectorAll("body *")].filter((element) => visible(element) && getComputedStyle(element).position !== "fixed" && element.getBoundingClientRect().right > vw + 1);
  // Report only the outermost offenders; children of an offender add nothing.
  const outermost = beyond.filter((element) => !beyond.includes(element.parentElement));
  const hidden = outermost.filter((element) => scroller(element)).map((element) => `${describe(element)} in scroller`);
  const overflowing = outermost.filter((element) => !scroller(element)).map((element) => `${describe(element)} → ${Math.round(element.getBoundingClientRect().right)}px`);

  const small = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], label:has(> input[type=checkbox]), label:has(> input[type=radio])")]
    .filter((element) => visible(element) && !(element.matches("input[type=checkbox], input[type=radio]") && element.closest("label")))
    // Links inside running text are exempt (WCAG 2.5.8 inline exception).
    .filter((element) => !(element.tagName === "A" && element.parentElement && ["P", "SPAN", "LI"].includes(element.parentElement.tagName) && element.parentElement.childNodes.length > 1 && [...element.parentElement.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())))
    .filter((element) => { const rect = element.getBoundingClientRect(); return rect.height < minTarget || rect.width < minTarget; })
    .map((element) => { const rect = element.getBoundingClientRect(); return `${describe(element)} ${Math.round(rect.width)}×${Math.round(rect.height)}`; });

  const tinyInputs = mobile ? [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([readonly])")]
    .filter((element) => visible(element) && parseFloat(getComputedStyle(element).fontSize) < 16)
    .map((element) => `${describe(element)} ${getComputedStyle(element).fontSize}`) : [];

  // Text squeezed into a sliver (one character per line) means a flex/grid column collapsed.
  const squeezed = [...document.querySelectorAll("body *")].filter((element) => {
    // A fully collapsed column can be 0px wide, which the generic visibility check would skip.
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || element.closest(".sr-only, [aria-hidden='true'], [popover]:not(:popover-open)")) return false;
    const text = [...element.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent.trim()).join("");
    if (text.length < 4) return false;
    const rect = element.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(element).lineHeight) || 20;
    return rect.height > line * 3 && rect.width < 40;
  }).map((element) => `${describe(element)} ${Math.round(element.getBoundingClientRect().width)}px wide`);

  return { pageOverflow, overflowing, hidden, small, tinyInputs, squeezed };
}

const browser = await chromium.launch({ executablePath: chromePath });
const fixture = await seed();
const pages = pagesFor(fixture);
let errors = 0, warnings = 0;
try {
  const login = await browser.newContext();
  const loginPage = await login.newPage();
  await loginPage.goto(`${base}/login`);
  await loginPage.fill('input[name="email"]', process.env.CHECK_EMAIL ?? "admin@checkinhub.local");
  await loginPage.fill('input[name="password"]', process.env.CHECK_PASSWORD ?? "CheckInHub123!");
  await loginPage.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await loginPage.waitForURL((url) => !url.pathname.startsWith("/login"));
  const staffState = await login.storageState();
  await login.close();

  for (const size of sizes) {
    const contexts = {
      public: await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.mobile, isMobile: size.mobile && size.width < 1024 }),
      staff: await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.mobile, isMobile: size.mobile && size.width < 1024, storageState: staffState }),
    };
    console.log(`\n■ ${size.name} (${size.width}×${size.height})`);
    for (const target of pages) {
      const page = await contexts[target.staff ? "staff" : "public"].newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message.split("\n")[0].slice(0, 120)));
      // Not "networkidle": live refresh keeps connections open.
      await page.goto(base + target.path, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(target.path.startsWith("/events/") ? 1500 : 300);
      await page.waitForTimeout(250);
      const result = await page.evaluate(inspect, { minTarget: target.touch ? 44 : 24, mobile: size.width < 768 });
      const problems = [];
      if (result.pageOverflow > 1) { errors++; problems.push(`  ✗ page scrolls sideways by ${result.pageOverflow}px: ${result.overflowing.slice(0, 4).join(" | ")}`); }
      if (pageErrors.length) { errors++; problems.push(`  ✗ page error: ${pageErrors.join(" | ")}`); }
      if (result.hidden.length) { warnings++; problems.push(`  ! hidden in horizontal scroller: ${result.hidden.slice(0, 3).join(" | ")}`); }
      if (result.small.length) { warnings++; problems.push(`  ! small tap targets (${result.small.length}): ${result.small.slice(0, 5).join(", ")}`); }
      if (result.squeezed.length) { warnings++; problems.push(`  ! squeezed text (${result.squeezed.length}): ${result.squeezed.slice(0, 4).join(", ")}`); }
      if (result.tinyInputs.length) { warnings++; problems.push(`  ! inputs under 16px (${result.tinyInputs.length}): ${result.tinyInputs.slice(0, 4).join(", ")}`); }
      console.log(`${problems.some((line) => line.startsWith("  ✗")) ? "✗" : problems.length ? "!" : "✓"} ${target.name}`);
      for (const line of problems) console.log(line);
      if (args.shots) {
        const dir = join(".responsive", size.name);
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: join(dir, `${target.name}.png`), fullPage: true });
      }
      await page.close();
    }
    await contexts.public.close();
    await contexts.staff.close();
  }
} finally {
  await browser.close();
  await db.event.deleteMany({ where: { id: { in: [fixture.event.id, fixture.draft.id] } } });
  await db.$disconnect();
}
console.log(`\n${errors} error(s), ${warnings} warning(s) across ${pages.length} pages × ${sizes.length} sizes`);
process.exit(errors ? 1 : 0);
