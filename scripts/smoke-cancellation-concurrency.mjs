import { randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = "http://localhost:3100";
const ip = `smoke-cancel-${randomUUID()}`;
let eventId;

function ensure(value, message) { if (!value) throw new Error(message); }
function formsFrom(html) { return html.split("<form").slice(1).map((part) => `<form${part.split("</form>")[0]}</form>`); }
function formDataFrom(html, values) {
  const data = new FormData();
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) data.set(match[1], (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

try {
  const suffix = randomUUID();
  const owner = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" }, select: { id: true } });
  const event = await db.event.create({ data: {
    slug: `cancel-smoke-${suffix}`, title: "Cancellation concurrency smoke", ownerId: owner.id,
    status: "PUBLISHED", autoApprove: true, waitlistEnabled: true, waitlistPromotion: "AUTO", registrationDeadline: new Date("2031-12-31T16:59:59.999Z"),
    fields: [{ key: "name", label: "ชื่อ", type: "text", required: true }],
    days: { create: [{ date: new Date("2031-12-30T00:00:00.000Z"), maxSeats: 2 }] },
  } });
  eventId = event.id;
  const day = await db.eventDay.findFirstOrThrow({ where: { eventId }, select: { id: true } });
  const publicUrl = `${base}/events/${event.slug}`;
  const html = await (await fetch(publicUrl)).text();
  const form = formsFrom(html).find((part) => part.includes('name="consent"'));
  ensure(form, "Registration form missing");
  // The server rejects forms submitted less than 3 seconds after they were rendered.
  await new Promise((resolve) => setTimeout(resolve, 3100));
  const statusUrls = [];
  for (let index = 0; index < 5; index++) {
    const response = await fetch(publicUrl, { method: "POST", redirect: "manual", headers: { origin: base, "x-forwarded-for": ip }, body: formDataFrom(form, { email: `cancel-${index}-${suffix}@example.invalid`, dayId: day.id, "answer:name": `Person ${index}`, consent: "on" }) });
    ensure(response.status === 303 && response.headers.get("location")?.includes("/status/"), `Registration failed: ${response.status}`);
    statusUrls.push(new URL(response.headers.get("location"), base));
  }
  const before = await db.registrant.groupBy({ by: ["status"], where: { eventId }, _count: true });
  ensure(before.find((item) => item.status === "APPROVED")?._count === 2 && before.find((item) => item.status === "WAITLISTED")?._count === 3, "Initial capacity state incorrect");
  const waitingBefore = await db.registrant.findMany({ where: { eventId, status: "WAITLISTED" }, orderBy: [{ registeredAt: "asc" }, { id: "asc" }], select: { id: true } });

  const cancellationForms = await Promise.all(statusUrls.slice(0, 2).map(async (url) => {
    const page = await (await fetch(url)).text();
    const cancelForm = formsFrom(page).find((part) => part.includes('name="confirm"'));
    ensure(cancelForm, "Self-cancellation form missing");
    return { url, cancelForm };
  }));
  const responses = await Promise.all(cancellationForms.map(({ url, cancelForm }) => fetch(url, { method: "POST", redirect: "manual", headers: { origin: base }, body: formDataFrom(cancelForm, { confirm: "on" }) })));
  ensure(responses.every((response) => response.status === 303), `Concurrent cancellations failed: ${responses.map((response) => response.status).join(", ")}`);
  const after = await db.registrant.groupBy({ by: ["status"], where: { eventId }, _count: true });
  ensure(after.find((item) => item.status === "CANCELLED")?._count === 2 && after.find((item) => item.status === "APPROVED")?._count === 2 && after.find((item) => item.status === "WAITLISTED")?._count === 1, `Promotion race: ${JSON.stringify(after)}`);
  const promoted = await db.registrant.findMany({ where: { eventId, status: "APPROVED" }, select: { id: true } });
  ensure(promoted.every((person) => waitingBefore.slice(0, 2).some((waiting) => waiting.id === person.id)), "Waitlist FIFO order was not preserved");
  process.stdout.write("Concurrent cancellations promoted exactly two registrants in waitlist order.\n");
} finally {
  if (eventId) await db.event.delete({ where: { id: eventId } });
  await db.$disconnect();
}
