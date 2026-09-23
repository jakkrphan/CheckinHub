import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

loadEnvConfig(process.cwd());

const name = process.env.CHECKIN_ADMIN_NAME?.trim();
const email = process.env.CHECKIN_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.CHECKIN_ADMIN_PASSWORD;

if (!name || !email || !password || password.length < 12) {
  throw new Error(
    "Set CHECKIN_ADMIN_NAME, CHECKIN_ADMIN_EMAIL, and CHECKIN_ADMIN_PASSWORD (12+ characters) before running admin:create."
  );
}

const db = new PrismaClient();

try {
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new Error("An account with this email already exists.");

  await db.user.create({
    data: {
      name,
      email,
      passwordHash: await hash(password, 12),
      role: "ADMIN",
    },
  });
  process.stdout.write(`Created admin account for ${email}.\n`);
} finally {
  await db.$disconnect();
}
