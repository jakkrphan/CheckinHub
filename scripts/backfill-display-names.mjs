// Fills Registrant.displayName for rows saved before the column existed (or after changing the name rules).
// Same rules as src/features/registrations/display-name.ts — keep the two in sync. Safe to run repeatedly.
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();

function displayNameOf(fields, answers) {
  const values = answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
  const text = (key) => typeof values[key] === "string" && values[key].trim() ? values[key].trim() : null;
  const textFields = (Array.isArray(fields) ? fields : []).filter((field) => field?.type === "text" && !field.sensitive);
  const nameField = textFields.find((field) => /ชื่อ|name/i.test(field.label ?? "") || /name/i.test(field.key ?? ""));
  const nameIsSensitive = (Array.isArray(fields) ? fields : []).some((field) => field?.key === "name" && field.sensitive);
  const value = (nameField && text(nameField.key)) ?? (nameIsSensitive ? null : text("name")) ?? textFields.filter((field) => field.required).map((field) => text(field.key)).find(Boolean) ?? null;
  return value ? value.slice(0, 191) : null;
}

let updated = 0;
try {
  for (const event of await db.event.findMany({ select: { id: true, fields: true } })) {
    let cursor;
    while (true) {
      const rows = await db.registrant.findMany({ where: { eventId: event.id }, select: { id: true, answers: true, displayName: true }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
      if (!rows.length) break;
      for (const row of rows) {
        const next = displayNameOf(event.fields, row.answers);
        if (next !== row.displayName) { await db.registrant.update({ where: { id: row.id }, data: { displayName: next } }); updated++; }
      }
      cursor = rows.at(-1).id;
    }
  }
  console.log(`displayName backfill: updated ${updated} registrant(s)`);
} finally {
  await db.$disconnect();
}
