import { createHash, randomBytes } from "node:crypto";

import type { Prisma, UserTokenKind } from "@prisma/client";

export const ACCOUNT_TOKEN_TTL_MS: Record<UserTokenKind, number> = {
  INVITE: 7 * 24 * 60 * 60 * 1000,
  RESET: 30 * 60 * 1000,
};

export const hashAccountToken = (token: string) => createHash("sha256").update(`account-token:${token}`).digest("hex");

/** Issues a one-time link token and revokes any earlier unused token of the same kind for that user. */
export async function issueAccountToken(tx: Prisma.TransactionClient, userId: string, kind: UserTokenKind, createdById: string, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  await tx.userToken.deleteMany({ where: { userId, kind, usedAt: null } });
  const record = await tx.userToken.create({
    data: { userId, kind, tokenHash: hashAccountToken(token), expiresAt: new Date(now.getTime() + ACCOUNT_TOKEN_TTL_MS[kind]), createdById },
    select: { expiresAt: true },
  });
  return { token, expiresAt: record.expiresAt };
}

export const accountLinkPath = (token: string) => `/account/setup/${token}`;
