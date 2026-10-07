import { randomInt } from "node:crypto";

import type { Prisma } from "@prisma/client";

// Check-in codes look like RPP-7Q2M-4KX9: short enough to read out or type at the desk.
// Codes issued before this format (43 random base64url characters, some with an RPP- prefix) stay valid as they are.

/** Upper-case letters and digits without 0/O and 1/I, which are easy to misread. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const MAX_ATTEMPTS = 5;

/** RPP- plus 8 random characters in two groups of four (32^8 ≈ 1.1 × 10^12 codes). */
export function newQrCode() {
  const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `RPP-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** A new code not yet held by anyone (qrCode is unique across all events), drawn again on the rare collision. */
export async function issueQrCode(tx: Prisma.TransactionClient) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = newQrCode();
    if (!await tx.registrant.findUnique({ where: { qrCode: code }, select: { id: true } })) return code;
  }
  throw new Error("Could not issue a unique check-in code");
}

/** What staff scanned or typed, as stored: new-format codes are matched without regard to case; older codes exactly. */
export function normalizeQrCode(input: string) {
  const code = input.trim();
  return /^rpp-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(code) ? code.toUpperCase() : code;
}
