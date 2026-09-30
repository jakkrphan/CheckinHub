import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Carries a "connect LINE" attempt from the status page through LINE Login and back, in an httpOnly cookie bound to
// the browser that started it: LINE's `state` must match the cookie (CSRF), `nonce` is checked in the ID token, and
// the registrant is the one whose status link started the flow. Signed so it cannot be edited; expires in 10 minutes.

export const LINE_LINK_COOKIE = "line-link";
export const LINE_LINK_MAX_AGE = 10 * 60;

/** `redirectUri` is the exact callback URL sent to LINE; the code exchange must repeat it byte for byte. */
export type LineLinkState = { state: string; nonce: string; registrantId: string; returnPath: string; redirectUri: string; expiresAt: number };

function sign(payload: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for LINE linking");
  return createHmac("sha256", secret).update(`line-link:${payload}`).digest("base64url");
}

export function newLineLinkState(registrantId: string, returnPath: string, redirectUri: string): LineLinkState {
  return { state: randomBytes(16).toString("base64url"), nonce: randomBytes(16).toString("base64url"), registrantId, returnPath, redirectUri, expiresAt: Date.now() + LINE_LINK_MAX_AGE * 1000 };
}

export function encodeLineLinkState(value: LineLinkState) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeLineLinkState(cookie: string | undefined): LineLinkState | null {
  const [payload, signature] = cookie?.split(".") ?? [];
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as LineLinkState;
    // Only ever send people back to a status page on this site.
    if (value.expiresAt < Date.now() || !/^\/events\/[^/?#]+\/status\/[^/?#]+$/.test(value.returnPath) || !/^https?:\/\/[^/]+\/api\/line\/callback$/.test(value.redirectUri)) return null;
    return value;
  } catch {
    return null;
  }
}
