import assert from "node:assert/strict";
import test from "node:test";

import {
  canAdministerEvent,
  canCheckIn,
  canManageEvent,
  canViewEvent,
  requiresAdminAudit,
} from "./policy.ts";

const membership = {
  systemRole: "organizer",
  userId: "user-1",
  ownerId: "owner-1",
  collaboratorRole: null,
};

test("an organizer without event membership cannot access the event", () => {
  assert.equal(canViewEvent(membership), false);
  assert.equal(canManageEvent(membership), false);
  assert.equal(canCheckIn(membership), false);
});

test("check-in-only collaborator can check in but cannot view organizer data", () => {
  const checkInOnly = { ...membership, collaboratorRole: "checkin_only" };
  assert.equal(canCheckIn(checkInOnly), true);
  assert.equal(canViewEvent(checkInOnly), false);
  assert.equal(canManageEvent(checkInOnly), false);
  assert.equal(canAdministerEvent(checkInOnly), false);
});

test("full collaborator can view and manage but cannot administer", () => {
  const full = { ...membership, collaboratorRole: "full" };
  assert.equal(canCheckIn(full), true);
  assert.equal(canViewEvent(full), true);
  assert.equal(canManageEvent(full), true);
  assert.equal(canAdministerEvent(full), false);
});

test("owner can administer and admin access requires an audit", () => {
  const owner = { ...membership, userId: membership.ownerId };
  const admin = { ...membership, systemRole: "admin" };
  assert.equal(canAdministerEvent(owner), true);
  assert.equal(requiresAdminAudit(owner), false);
  assert.equal(canCheckIn(admin), true);
  assert.equal(canAdministerEvent(admin), true);
  assert.equal(requiresAdminAudit(admin), true);
});
