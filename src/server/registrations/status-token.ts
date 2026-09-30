import { createHmac, timingSafeEqual } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { db } from "@/server/db";
import { hashBearerCode } from "@/server/registrations/registration";

// A status link has two forms:
//   <token>                    the random bearer code shown after registering (only its hash is stored)
//   l.<registrantId>.<sig>     for LINE messages, where the original code is gone; `sig` is an HMAC over the id and
//                              the current statusTokenHash, so reissuing the status link or anonymising the person
//                              also invalidates every link already sent over LINE.
const PREFIX = "l.";

function signature(registrantId: string, statusTokenHash: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for status links");
  return createHmac("sha256", secret).update(`line-status:${registrantId}:${statusTokenHash}`).digest("base64url");
}

export function lineStatusToken(registrant: { id: string; statusTokenHash: string }) {
  return `${PREFIX}${registrant.id}.${signature(registrant.id, registrant.statusTokenHash)}`;
}

/** `where` for db.registrant.findUnique from either form of status token; an invalid token matches nobody. */
export async function statusTokenWhere(token: string): Promise<Prisma.RegistrantWhereUniqueInput> {
  if (!token.startsWith(PREFIX)) return { statusTokenHash: hashBearerCode(token) };
  const [id, sig] = token.slice(PREFIX.length).split(".");
  if (id && sig && /^[a-z0-9]{20,40}$/.test(id)) {
    const person = await db.registrant.findUnique({ where: { id }, select: { statusTokenHash: true } });
    if (person) {
      const expected = Buffer.from(signature(id, person.statusTokenHash));
      const given = Buffer.from(sig);
      if (expected.length === given.length && timingSafeEqual(expected, given)) return { id };
    }
  }
  return { statusTokenHash: "invalid" };
}
