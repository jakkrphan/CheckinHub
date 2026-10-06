// Unit tests for the signed LINE `state`, which lets the callback verify an attempt without the state cookie.
import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH_SECRET ??= "test-secret-for-line-link-state";

const { lineNonceFor, newLineLinkState, verifyLineState } = await import("./link-state.ts");

const registrantId = "cmabcdefghij0123456789xy";
const link = () => newLineLinkState(registrantId, "/events/demo/status/secret-code", "https://example.test/api/line/callback");

test("a fresh state verifies to its registrant and derives the nonce", () => {
  const value = link();
  assert.equal(verifyLineState(value.state)?.registrantId, registrantId);
  assert.equal(value.nonce, lineNonceFor(value.state));
});

test("the state never carries the status token", () => {
  assert.ok(!link().state.includes("secret-code"));
});

test("each attempt gets a different state", () => {
  assert.notEqual(link().state, link().state);
});

test("edited, forged or malformed states are refused", () => {
  const [, expiry, random, signature] = link().state.split(".");
  assert.equal(verifyLineState(`cmotherregistrant0000000000.${expiry}.${random}.${signature}`), null);
  assert.equal(verifyLineState(`${registrantId}.${(Date.now() + 9e9).toString(36)}.${random}.${signature}`), null);
  assert.equal(verifyLineState(`${registrantId}.${expiry}.${random}.forged`), null);
  for (const value of [null, undefined, "", "y", "a.b.c", "a.b.c.d.e"]) assert.equal(verifyLineState(value), null);
});

test("an expired state is refused", (context) => {
  const value = link();
  context.mock.method(Date, "now", () => value.expiresAt + 1);
  assert.equal(verifyLineState(value.state), null);
});
