import { createHash } from "node:crypto";

import { db } from "@/server/db";

const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LIMIT = 5;
// Offices often share one public IP, so the per-IP ceiling is looser than the per-account one.
const IP_LIMIT = 20;

function keyHash(kind: "account" | "ip", value: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required");
  return createHash("sha256").update(`${secret}:login:${kind}:${value}`).digest("hex");
}

export function loginKeys(email: string, ip: string) {
  return { account: keyHash("account", email), ip: keyHash("ip", ip) };
}

export async function isLoginThrottled(keys: { account: string; ip: string }, now = new Date()) {
  const since = new Date(now.getTime() - WINDOW_MS);
  const [account, ip] = await Promise.all([
    db.loginAttempt.count({ where: { keyHash: keys.account, createdAt: { gte: since } } }),
    db.loginAttempt.count({ where: { keyHash: keys.ip, createdAt: { gte: since } } }),
  ]);
  return account >= ACCOUNT_LIMIT || ip >= IP_LIMIT;
}

export async function recordLoginFailure(keys: { account: string; ip: string }) {
  await db.loginAttempt.createMany({ data: [{ keyHash: keys.account }, { keyHash: keys.ip }] });
}

/** A successful sign-in clears the account's failure count; the IP count keeps aging out on its own. */
export async function clearAccountFailures(keys: { account: string }) {
  await db.loginAttempt.deleteMany({ where: { keyHash: keys.account } });
}

export async function pruneLoginAttempts(now = new Date()) {
  await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - WINDOW_MS) } } });
}
