import { randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("Set CRON_SECRET before running this check");
const eventIds = [];

function ensure(value, message) { if (!value) throw new Error(message); }

async function createScenario(ownerId, policy) {
  const event = await db.event.create({ data: {
    slug: `hold-smoke-${randomUUID()}`, title: "Pending hold smoke", ownerId,
    status: "PUBLISHED", fields: [], autoApprove: false, pendingHoldHours: 1,
    waitlistPromotion: policy,
    days: { create: { date: new Date("2031-12-30T00:00:00.000Z"), maxSeats: 1 } },
  }, include: { days: true } });
  eventIds.push(event.id);
  const dayId = event.days[0].id;
  const older = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const pending = await db.registrant.create({ data: {
    eventId: event.id, email: `${randomUUID()}@example.invalid`, answers: {},
    status: "PENDING", statusTokenHash: randomUUID(),
    days: { create: { eventDayId: dayId, status: "PENDING", pendingSince: older } },
  } });
  const waiting = await db.registrant.create({ data: {
    eventId: event.id, email: `${randomUUID()}@example.invalid`, answers: {},
    status: "WAITLISTED", statusTokenHash: randomUUID(),
    days: { create: { eventDayId: dayId, status: "WAITLISTED", waitlistedAt: older } },
  } });
  return { pendingId: pending.id, waitingId: waiting.id };
}

try {
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" }, select: { id: true } });
  const auto = await createScenario(admin.id, "AUTO");
  const manual = await createScenario(admin.id, "MANUAL");
  const url = "http://localhost:3100/api/jobs/pending-holds";
  ensure((await fetch(url)).status === 401, "Maintenance endpoint allowed an unauthenticated request");
  const response = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
  const result = await response.json();
  ensure(response.status === 200 && result.expiredRows === 2, "Expired pending holds were not released");
  const [autoPending, autoWaiting, manualPending, manualWaiting] = await Promise.all(
    [auto.pendingId, auto.waitingId, manual.pendingId, manual.waitingId].map((id) => db.registrant.findUniqueOrThrow({ where: { id }, include: { days: true } })),
  );
  ensure(autoPending.status === "WAITLISTED" && autoPending.days[0].status === "WAITLISTED", "Expired applicant was not moved to waitlist");
  ensure(autoWaiting.status === "PENDING" && autoWaiting.days[0].status === "PENDING" && autoWaiting.days[0].pendingSince, "Automatic promotion did not fill the released seat");
  ensure(manualPending.status === "WAITLISTED" && manualWaiting.status === "WAITLISTED", "Manual promotion changed the waitlist");
  const again = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
  ensure(again.status === 200 && (await again.json()).expiredRows === 0, "Expiry job was not idempotent");
  process.stdout.write("Pending hold expiry and automatic/manual waitlist policies passed.\n");
} finally {
  for (const id of eventIds) await db.event.delete({ where: { id } });
  await db.$disconnect();
}
