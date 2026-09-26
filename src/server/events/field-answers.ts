import { Prisma } from "@prisma/client";

import { db } from "@/server/db";

type Client = Prisma.TransactionClient | typeof db;

/** JSON path for one top-level answer key, quoted so any stored key is matched literally. */
const answerPath = (key: string) => `$."${key.replace(/["\\]/g, (char) => `\\${char}`)}"`;

/**
 * How many registrants of an event have an answer stored under each field key (any value, any status).
 * Used to warn before a form change would leave those answers as keys no longer in the form.
 */
export async function countAnswersByField(eventId: string, keys: string[], client: Client = db) {
  const counts = new Map<string, number>(keys.map((key) => [key, 0]));
  if (!keys.length) return counts;
  const columns = keys.map((key, index) => Prisma.sql`COUNT(CASE WHEN JSON_CONTAINS_PATH(answers, 'one', ${answerPath(key)}) THEN 1 END) AS ${Prisma.raw(`c${index}`)}`);
  const [row] = await client.$queryRaw<Record<string, bigint | number>[]>(Prisma.sql`SELECT ${Prisma.join(columns, ", ")} FROM Registrant WHERE eventId = ${eventId}`);
  keys.forEach((key, index) => counts.set(key, Number(row?.[`c${index}`] ?? 0)));
  return counts;
}
