// Unit tests for check-in codes: the RPP-XXXX-XXXX format, collision retry, and how typed codes are matched.
import assert from "node:assert/strict";
import test from "node:test";

import { issueQrCode, newQrCode, normalizeQrCode } from "./qr-code.ts";

test("codes look like RPP-7Q2M-4KX9 without 0, O, 1 or I", () => {
  for (let i = 0; i < 1000; i++) assert.match(newQrCode(), /^RPP-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
});

test("codes do not repeat in practice", () => {
  assert.equal(new Set(Array.from({ length: 10000 }, newQrCode)).size, 10000);
});

const txWithTaken = (taken) => ({ registrant: { findUnique: async ({ where }) => taken(where.qrCode) ? { id: "someone" } : null } });

test("a code someone already holds is drawn again", async () => {
  let calls = 0;
  const code = await issueQrCode(txWithTaken(() => ++calls < 3));
  assert.equal(calls, 3);
  assert.match(code, /^RPP-/);
});

test("gives up instead of looping forever", async () => {
  await assert.rejects(issueQrCode(txWithTaken(() => true)), /unique check-in code/);
});

test("typed new-format codes match regardless of case and spaces; older codes are left exact", () => {
  assert.equal(normalizeQrCode("  rpp-7q2m-4kx9 "), "RPP-7Q2M-4KX9");
  assert.equal(normalizeQrCode("aB3_-xYz"), "aB3_-xYz");
  assert.equal(normalizeQrCode("RPP-aB3dEf9_long-old-format"), "RPP-aB3dEf9_long-old-format");
});
