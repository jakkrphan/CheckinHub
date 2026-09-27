// Unit tests for seat counting and waitlist promotion in both seat modes (spec: "unit test ของ logic คำนวณที่นั่ง/
// waitlist ทั้งสองโหมด"). They run against a small in-memory stand-in for the Prisma transaction client, so no
// database is needed; concurrency is covered separately by the integration suites.
import assert from "node:assert/strict";
import test from "node:test";

import { getSeatAvailability, summarizeDayStatuses } from "./day-status.ts";
import { promoteNextManually, promoteWaitlist } from "./lifecycle.ts";

/** Matches the handful of `where` shapes the seat/queue code uses. */
function matches(item, where = {}, related = {}) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "eventDay") return matches(related.eventDay(item), condition, related);
    if (key === "registrant") return matches(related.registrant(item), condition, related);
    const value = item[key];
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      if ("in" in condition) return condition.in.includes(value);
      if ("notIn" in condition) return !condition.notIn.includes(value);
    }
    return value === condition;
  });
}

function byQueueOrder(a, b) {
  return (a.waitlistedAt?.getTime() ?? 0) - (b.waitlistedAt?.getTime() ?? 0) || a.id.localeCompare(b.id);
}

function fakeTx({ event, days = [], people = [] }) {
  const state = {
    event: { status: "PUBLISHED", waitlistPromotion: "AUTO", seatMode: "per_day", maxSeats: null, ...event },
    days: days.map((day) => ({ isClosed: false, maxSeats: null, eventId: event.id, ...day })),
    people: people.map((person) => ({ eventId: event.id, qrCode: null, approvedAt: null, cancelledAt: null, autoApproveAtRegistration: true, dedupeKey: person.id, ...person, days: undefined })),
    rows: people.flatMap((person) => person.days.map((row, index) => ({ id: `${person.id}-r${index}`, registrantId: person.id, waitlistedAt: null, pendingSince: null, ...row }))),
  };
  const related = {
    eventDay: (row) => state.days.find((day) => day.id === row.eventDayId),
    registrant: (row) => state.people.find((person) => person.id === row.registrantId),
  };
  const withRelations = (row) => row && { ...row, registrant: related.registrant(row), eventDay: related.eventDay(row) };
  const tx = {
    state,
    $queryRaw: async () => [],
    event: {
      findUniqueOrThrow: async ({ where }) => { assert.equal(where.id, state.event.id); return { ...state.event }; },
    },
    eventDay: {
      findMany: async ({ where }) => state.days.filter((day) => matches(day, where)).sort((a, b) => a.id.localeCompare(b.id)),
      findUniqueOrThrow: async ({ where }) => state.days.find((day) => day.id === where.id),
    },
    registrant: {
      count: async ({ where }) => state.people.filter((person) => matches(person, where)).length,
      findUniqueOrThrow: async ({ where }) => {
        const person = state.people.find((item) => item.id === where.id);
        return { ...person, days: state.rows.filter((row) => row.registrantId === person.id) };
      },
      update: async ({ where, data }) => Object.assign(state.people.find((person) => person.id === where.id), data),
    },
    registrantEventDay: {
      count: async ({ where }) => state.rows.filter((row) => matches(row, where, related)).length,
      findMany: async ({ where }) => state.rows.filter((row) => matches(row, where, related)).map(withRelations),
      findFirst: async ({ where }) => withRelations(state.rows.filter((row) => matches(row, where, related)).sort(byQueueOrder)[0]) ?? null,
      update: async ({ where, data }) => Object.assign(state.rows.find((row) => row.id === where.id), data),
      updateMany: async ({ where, data }) => {
        const rows = state.rows.filter((row) => matches(row, where, related));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    },
  };
  return tx;
}

const at = (minute) => new Date(Date.UTC(2031, 0, 1, 8, minute));
const statusOf = (tx, id) => tx.state.people.find((person) => person.id === id).status;
const rowsOf = (tx, id) => tx.state.rows.filter((row) => row.registrantId === id).map((row) => row.status);

test("a registrant's overall status follows the best status among their days", () => {
  assert.equal(summarizeDayStatuses(["WAITLISTED", "APPROVED"]), "APPROVED");
  assert.equal(summarizeDayStatuses(["WAITLISTED", "PENDING"]), "PENDING");
  assert.equal(summarizeDayStatuses(["CANCELLED", "WAITLISTED"]), "WAITLISTED");
  assert.equal(summarizeDayStatuses(["CANCELLED", "CANCELLED"]), "CANCELLED");
  assert.equal(summarizeDayStatuses(["CANCELLED", "REJECTED"]), "REJECTED");
});

test("per-day seats count pending and approved only, never go below zero, and unlimited days stay null", async () => {
  const tx = fakeTx({
    event: { id: "e1" },
    days: [{ id: "d1", maxSeats: 2 }, { id: "d2", maxSeats: 1 }, { id: "d3", maxSeats: null }],
    people: [
      { id: "p1", status: "APPROVED", days: [{ eventDayId: "d1", status: "APPROVED" }, { eventDayId: "d2", status: "APPROVED" }] },
      { id: "p2", status: "PENDING", days: [{ eventDayId: "d2", status: "PENDING" }, { eventDayId: "d3", status: "PENDING" }] },
      { id: "p3", status: "WAITLISTED", days: [{ eventDayId: "d1", status: "WAITLISTED", waitlistedAt: at(1) }] },
      { id: "p4", status: "CANCELLED", days: [{ eventDayId: "d1", status: "CANCELLED" }] },
    ],
  });
  const availability = await getSeatAvailability(tx, tx.state.event, ["d1", "d2", "d3"]);
  assert.equal(availability.mode, "per_day");
  assert.deepEqual(availability.days.get("d1"), { taken: 1, remaining: 1 });
  assert.deepEqual(availability.days.get("d2"), { taken: 2, remaining: 0 }, "over capacity (manual override) reads as full, not negative");
  assert.deepEqual(availability.days.get("d3"), { taken: 1, remaining: null });
});

test("whole-course seats count people, not day rows", async () => {
  const tx = fakeTx({
    event: { id: "e1", seatMode: "whole_course", maxSeats: 3 },
    days: [{ id: "d1" }, { id: "d2" }],
    people: [
      { id: "p1", status: "APPROVED", days: [{ eventDayId: "d1", status: "APPROVED" }, { eventDayId: "d2", status: "APPROVED" }] },
      { id: "p2", status: "PENDING", days: [{ eventDayId: "d1", status: "PENDING" }, { eventDayId: "d2", status: "PENDING" }] },
      { id: "p3", status: "WAITLISTED", days: [{ eventDayId: "d1", status: "WAITLISTED" }, { eventDayId: "d2", status: "WAITLISTED" }] },
    ],
  });
  assert.deepEqual(await getSeatAvailability(tx, tx.state.event, []), { mode: "whole_course", taken: 2, remaining: 1 });
  tx.state.event.maxSeats = null;
  assert.deepEqual(await getSeatAvailability(tx, tx.state.event, []), { mode: "whole_course", taken: 2, remaining: null });
});

function perDayQueue(event = {}) {
  return fakeTx({
    event: { id: "e1", ...event },
    days: [{ id: "d1", maxSeats: 2 }, { id: "d2", maxSeats: 1, isClosed: true }],
    people: [
      { id: "held", status: "APPROVED", days: [{ eventDayId: "d1", status: "APPROVED" }] },
      { id: "second", status: "WAITLISTED", autoApproveAtRegistration: false, days: [{ eventDayId: "d1", status: "WAITLISTED", waitlistedAt: at(5) }] },
      { id: "first", status: "WAITLISTED", days: [{ eventDayId: "d1", status: "WAITLISTED", waitlistedAt: at(2) }] },
      { id: "closedDay", status: "WAITLISTED", days: [{ eventDayId: "d2", status: "WAITLISTED", waitlistedAt: at(1) }] },
    ],
  });
}

test("per-day auto promotion fills free seats in queue order and issues a QR", async () => {
  const tx = perDayQueue();
  await promoteWaitlist(tx, "e1");
  assert.equal(statusOf(tx, "first"), "APPROVED");
  assert.ok(tx.state.people.find((person) => person.id === "first").qrCode, "promoted registrant gets a QR");
  assert.equal(statusOf(tx, "second"), "WAITLISTED", "only one seat was free");
  assert.equal(statusOf(tx, "closedDay"), "WAITLISTED", "closed days are never promoted");
});

test("promotion keeps the approval mode the person registered under", async () => {
  const tx = perDayQueue();
  tx.state.days[0].maxSeats = 3;
  await promoteWaitlist(tx, "e1");
  assert.equal(statusOf(tx, "first"), "APPROVED");
  assert.equal(statusOf(tx, "second"), "PENDING");
  assert.ok(tx.state.rows.find((row) => row.registrantId === "second").pendingSince instanceof Date);
});

test("rows being released right now are not promoted into their own seat", async () => {
  const tx = perDayQueue();
  await promoteWaitlist(tx, "e1", ["first-r0"]);
  assert.equal(statusOf(tx, "first"), "WAITLISTED");
  assert.equal(statusOf(tx, "second"), "PENDING");
});

test("manual-promotion and unpublished events never promote automatically", async () => {
  for (const event of [{ waitlistPromotion: "MANUAL" }, { status: "CLOSED" }]) {
    const tx = perDayQueue(event);
    await promoteWaitlist(tx, "e1");
    assert.equal(statusOf(tx, "first"), "WAITLISTED", JSON.stringify(event));
  }
});

test("manual promotion moves exactly one person up, and nothing once the day is full", async () => {
  const tx = perDayQueue({ waitlistPromotion: "MANUAL" });
  assert.equal(await promoteNextManually(tx, "e1", "d1"), "first");
  assert.equal(statusOf(tx, "second"), "WAITLISTED");
  assert.equal(await promoteNextManually(tx, "e1", "d1"), null, "day is full now");
  assert.equal(await promoteNextManually(tx, "e1", "d2"), null, "closed day");
  assert.equal(await promoteNextManually(tx, "e1", "other-event-day"), null);
  assert.equal(await promoteNextManually(tx, "e1", null), null, "per-day events have no course queue");
});

function courseQueue(event = {}) {
  return fakeTx({
    event: { id: "e1", seatMode: "whole_course", maxSeats: 2, ...event },
    days: [{ id: "d1" }, { id: "d2" }],
    people: [
      { id: "held", status: "APPROVED", days: [{ eventDayId: "d1", status: "APPROVED" }, { eventDayId: "d2", status: "APPROVED" }] },
      { id: "second", status: "WAITLISTED", days: [{ eventDayId: "d1", status: "WAITLISTED", waitlistedAt: at(5) }, { eventDayId: "d2", status: "WAITLISTED", waitlistedAt: at(5) }] },
      { id: "first", status: "WAITLISTED", days: [{ eventDayId: "d1", status: "WAITLISTED", waitlistedAt: at(2) }, { eventDayId: "d2", status: "WAITLISTED", waitlistedAt: at(2) }] },
    ],
  });
}

test("whole-course auto promotion moves the first person up on every day together", async () => {
  const tx = courseQueue();
  await promoteWaitlist(tx, "e1");
  assert.deepEqual(rowsOf(tx, "first"), ["APPROVED", "APPROVED"]);
  assert.equal(statusOf(tx, "first"), "APPROVED");
  assert.deepEqual(rowsOf(tx, "second"), ["WAITLISTED", "WAITLISTED"]);
});

test("whole-course promotion skips people whose seat is being released", async () => {
  const tx = courseQueue({ maxSeats: 3 });
  await promoteWaitlist(tx, "e1", ["first-r0"]);
  assert.equal(statusOf(tx, "first"), "WAITLISTED");
  assert.equal(statusOf(tx, "second"), "APPROVED");
});

test("whole-course manual promotion uses the course queue only", async () => {
  const tx = courseQueue({ waitlistPromotion: "MANUAL" });
  assert.equal(await promoteNextManually(tx, "e1", "d1"), null, "a day id is not a course queue");
  assert.equal(await promoteNextManually(tx, "e1", null), "first");
  assert.equal(await promoteNextManually(tx, "e1", null), null, "course is full now");
});
