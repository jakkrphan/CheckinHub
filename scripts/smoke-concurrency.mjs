import { randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = "http://localhost:3100";
const smokeIp = `smoke-concurrency-${randomUUID()}`;
let eventId;

function ensure(condition, message) { if (!condition) throw new Error(message); }
function formDataFrom(html, values) {
  const form = new FormData();
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) {
    form.set(match[1], (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  }
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  return form;
}

try {
  const suffix = randomUUID();
  const owner = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" }, select: { id: true } });
  const event = await db.event.create({ data: {
    slug: `concurrency-smoke-${suffix}`, title: "Concurrency smoke", ownerId: owner.id,
    status: "PUBLISHED", autoApprove: true, registrationDeadline: new Date("2031-12-31T16:59:59.999Z"),
    fields: [{ key: "name", label: "ชื่อ", type: "text", required: true }],
    days: { create: [{ date: new Date("2031-12-30T00:00:00.000Z"), maxSeats: 5 }] },
  } });
  eventId = event.id;
  const day = await db.eventDay.findFirstOrThrow({ where: { eventId }, select: { id: true } });
  const url = `${base}/events/${event.slug}`;
  const html = await (await fetch(url)).text();
  const form = html.split("<form").slice(1).map((part) => `<form${part.split("</form>")[0]}</form>`).find((part) => part.includes('name="consent"'));
  ensure(form, "Public registration form missing");
  // The server rejects forms submitted less than 3 seconds after they were rendered.
  await new Promise((resolve) => setTimeout(resolve, 3100));

  const responses = await Promise.all(Array.from({ length: 50 }, (_, index) => fetch(url, {
    method: "POST", redirect: "manual", headers: { origin: base, "x-forwarded-for": `${smokeIp}-${index}` },
    body: formDataFrom(form, { email: `concurrent-${index}-${suffix}@example.invalid`, dayId: day.id, "answer:name": `Person ${index}`, consent: "on" }),
  })));
  ensure(responses.every((response) => response.status === 303 && response.headers.get("location")?.includes("/status/")), `Concurrent submit failures: ${responses.map((response) => `${response.status}:${response.headers.get("location")}`).join(", ")}`);
  const counts = await db.registrant.groupBy({ by: ["status"], where: { eventId }, _count: true });
  const approved = counts.find((row) => row.status === "APPROVED")?._count ?? 0;
  const waiting = counts.find((row) => row.status === "WAITLISTED")?._count ?? 0;
  ensure(approved === 5 && waiting === 45, `Seat allocation race: approved=${approved}, waitlisted=${waiting}`);
  const qrCount = await db.registrant.count({ where: { eventId, status: "APPROVED", qrCode: { not: null } } });
  ensure(qrCount === 5, "Concurrent auto-approval QR count incorrect");
  process.stdout.write("Fifty concurrent registrations respected five seats and placed 45 on the waitlist.\n");
} finally {
  if (eventId) await db.event.delete({ where: { id: eventId } });
  await db.$disconnect();
}
