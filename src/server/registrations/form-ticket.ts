import { createHmac, timingSafeEqual } from "node:crypto";

const MIN_FILL_MS = 3_000;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function sign(issuedAt: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required");
  return createHmac("sha256", secret).update(`form-ticket:${issuedAt}`).digest("base64url");
}

/** Signed render timestamp so the server can reject forms submitted implausibly fast. */
export function issueFormTicket(now = Date.now()) {
  const issuedAt = String(now);
  return `${issuedAt}.${sign(issuedAt)}`;
}

export type FormTicketCheck = "ok" | "too-fast" | "expired" | "invalid";

export function checkFormTicket(value: FormDataEntryValue | null, now = Date.now()): FormTicketCheck {
  if (typeof value !== "string") return "invalid";
  const [issuedAt, signature] = value.split(".");
  if (!issuedAt || !signature || !/^\d{13}$/.test(issuedAt)) return "invalid";
  const expected = Buffer.from(sign(issuedAt));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return "invalid";
  const age = now - Number(issuedAt);
  if (age < MIN_FILL_MS) return "too-fast";
  if (age > MAX_AGE_MS) return "expired";
  return "ok";
}

/** Hidden honeypot input name; people never see or fill it. */
export const HONEYPOT_FIELD = "website";
