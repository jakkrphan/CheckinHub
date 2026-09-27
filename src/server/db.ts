import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// PDPA: "minimal" keeps query arguments (emails, answers) out of error messages, which end up in server logs.
export const db = globalForPrisma.prisma ?? new PrismaClient({ errorFormat: "minimal" });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
