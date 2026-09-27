import type { RegistrationFieldConfig } from "@/features/events/registration-fields";

export const DISPLAY_NAME_MAX = 191;

/**
 * The registrant's name, denormalized into `Registrant.displayName` for search and ordering (spec 1.7): the first
 * non-sensitive text field that looks like a name, else an answer keyed `name`, else the first required text answer.
 * Returns null when nothing fits (the UI then falls back to the email).
 * Keep in sync with scripts/backfill-display-names.mjs.
 */
export function registrantDisplayName(fields: RegistrationFieldConfig[], answers: unknown): string | null {
  const values = answers && typeof answers === "object" && !Array.isArray(answers) ? answers as Record<string, unknown> : {};
  const text = (key: string) => typeof values[key] === "string" && (values[key] as string).trim() ? (values[key] as string).trim() : null;
  const textFields = fields.filter((field) => field.type === "text" && !field.sensitive);
  const nameField = textFields.find((field) => /ชื่อ|name/i.test(field.label) || /name/i.test(field.key));
  const value = (nameField && text(nameField.key)) ?? (fields.some((field) => field.key === "name" && field.sensitive) ? null : text("name")) ?? textFields.filter((field) => field.required).map((field) => text(field.key)).find(Boolean) ?? null;
  return value ? value.slice(0, DISPLAY_NAME_MAX) : null;
}

/** Everything in a form that `registrantDisplayName` looks at; when this is unchanged, stored names stay valid. */
export function displayNameRulesKey(fields: RegistrationFieldConfig[]) {
  return JSON.stringify(fields.filter((field) => field.type === "text" || field.key === "name").map((field) => [field.key, field.label, field.type, field.required, field.sensitive]));
}
