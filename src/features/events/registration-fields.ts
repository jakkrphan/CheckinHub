import { z } from "zod";

const conditionalRuleSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["equals", "in", "includes"]),
  value: z.union([z.string(), z.array(z.string())]),
});

export const registrationFieldSchema = z.object({
  key: z.string().min(1).max(191),
  label: z.string().trim().min(1).max(191),
  type: z.enum(["text", "textarea", "email", "tel", "date", "select", "checkbox", "file"]),
  required: z.boolean(),
  showOnCheckin: z.boolean().default(false),
  sensitive: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(191)).max(30).optional(),
  acceptedFileTypes: z.array(z.string()).optional(),
  maxFileSizeMb: z.number().positive().optional(),
  /** Files per answer: 1 stores one file object (the original shape), 3 stores an array of up to 3. */
  maxFiles: z.union([z.literal(1), z.literal(3)]).optional(),
  conditional: conditionalRuleSchema.optional(),
});

export const registrationFieldsSchema = z.array(registrationFieldSchema).max(50);

export type RegistrationFieldConfig = z.infer<typeof registrationFieldSchema>;
export type RegistrationFileAnswer = { storageKey: string; originalName: string; contentType: string; size: number };
export type RegistrationAnswerValue = string | string[] | RegistrationFileAnswer | RegistrationFileAnswer[];

/** File types an organizer can allow; docx is detected from its ZIP container (see local-files.ts). */
export const registrationFileTypes = ["pdf", "jpg", "jpeg", "png", "webp", "docx"] as const;

export const isRegistrationFileAnswer = (value: unknown): value is RegistrationFileAnswer =>
  !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as { storageKey?: unknown }).storageKey === "string";

/** Reads a stored file answer in either shape (one object, or an array for multi-file fields). */
export function readFileAnswers(value: unknown): RegistrationFileAnswer[] {
  return (Array.isArray(value) ? value : [value]).filter(isRegistrationFileAnswer);
}

export const maxFilesOf = (field: RegistrationFieldConfig) => field.type === "file" && field.maxFiles === 3 ? 3 : 1;

export function readRegistrationFields(value: unknown): RegistrationFieldConfig[] {
  const parsed = registrationFieldsSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid event registration field configuration");
  return parsed.data;
}

export function validateRegistrationFields(fields: RegistrationFieldConfig[]) {
  if (fields.length === 0) return false;
  const seen = new Map<string, RegistrationFieldConfig>();
  for (const field of fields) {
    if (seen.has(field.key)) return false;
    if (field.showOnCheckin && (field.sensitive || field.type === "file")) return false;
    if ((field.type === "select" || field.type === "checkbox") && (!field.options?.length || new Set(field.options).size !== field.options.length)) return false;
    if (field.type === "file" && (!field.acceptedFileTypes?.length || field.acceptedFileTypes.some((type) => !(registrationFileTypes as readonly string[]).includes(type.toLowerCase().replace(/^\./, ""))) || !field.maxFileSizeMb || field.maxFileSizeMb > 5)) return false;
    if (field.conditional) {
      const parent = seen.get(field.conditional.field);
      if (!parent || !["select", "checkbox"].includes(parent.type)) return false;
      const values = Array.isArray(field.conditional.value) ? field.conditional.value : [field.conditional.value];
      if (!values.length || values.some((value) => !parent.options?.includes(value))) return false;
    }
    seen.set(field.key, field);
  }
  return true;
}

export function conditionMatches(field: RegistrationFieldConfig, answers: Record<string, RegistrationAnswerValue>) {
  if (!field.conditional) return true;
  const answer = answers[field.conditional.field];
  const values = Array.isArray(field.conditional.value) ? field.conditional.value : [field.conditional.value];
  const selected = Array.isArray(answer) ? answer.filter((item): item is string => typeof item === "string") : null;
  if (field.conditional.operator === "equals") return typeof answer === "string" && values.includes(answer);
  if (field.conditional.operator === "in") return selected ? selected.some((item) => values.includes(item)) : typeof answer === "string" && values.includes(answer);
  return !!selected && selected.some((item) => values.includes(item));
}

export type AnswerProblem = { fieldKey: string | null; reason: "required" | "invalid" };

/**
 * Validates submitted answers against the form. On failure returns which field failed and why, so the form can
 * say more than "invalid" (`fieldKey` is null when the form configuration itself is broken).
 */
export function checkRegistrationAnswers(fields: RegistrationFieldConfig[], formData: FormData, uploads: Record<string, RegistrationFileAnswer | RegistrationFileAnswer[]> = {}): { answers: Record<string, RegistrationAnswerValue> } | { problem: AnswerProblem } {
  if (!validateRegistrationFields(fields)) return { problem: { fieldKey: null, reason: "invalid" } };
  const fail = (field: RegistrationFieldConfig, reason: AnswerProblem["reason"]) => ({ problem: { fieldKey: field.key, reason } });
  const answers: Record<string, RegistrationAnswerValue> = {};

  for (const field of fields) {
    if (!conditionMatches(field, answers)) continue;
    if (field.type === "file") {
      const files = readFileAnswers(uploads[field.key]);
      if (field.required && !files.length) return fail(field, "required");
      // Single-file fields keep the original object shape; multi-file fields always store an array.
      // The file count is enforced at upload time, so files kept from before a maxFiles change stay intact.
      if (files.length) answers[field.key] = maxFilesOf(field) > 1 || files.length > 1 ? files : files[0];
      continue;
    }

    const values = formData.getAll(`answer:${field.key}`);
    if (field.type === "checkbox") {
      const selected = values.filter((value): value is string => typeof value === "string" && value.length > 0);
      if (selected.some((value) => !field.options?.includes(value)) || selected.length !== new Set(selected).size) return fail(field, "invalid");
      if (field.required && selected.length === 0) return fail(field, "required");
      answers[field.key] = selected;
      continue;
    }

    if (values.length > 1 || (values[0] !== undefined && typeof values[0] !== "string")) return fail(field, "invalid");
    const value = typeof values[0] === "string" ? values[0].trim() : "";
    if (field.required && !value) return fail(field, "required");
    if (value.length > 3000) return fail(field, "invalid");
    if (field.type === "select" && value && !field.options?.includes(value)) return fail(field, "invalid");
    if (field.type === "email" && value && !z.email().safeParse(value).success) return fail(field, "invalid");
    if (field.type === "tel" && value && !/^[+0-9() .-]{6,30}$/.test(value)) return fail(field, "invalid");
    if (field.type === "date" && value && !z.iso.date().safeParse(value).success) return fail(field, "invalid");
    answers[field.key] = value;
  }

  return { answers };
}

export function parseRegistrationAnswers(fields: RegistrationFieldConfig[], formData: FormData, uploads: Record<string, RegistrationFileAnswer | RegistrationFileAnswer[]> = {}) {
  const result = checkRegistrationAnswers(fields, formData, uploads);
  return "answers" in result ? result.answers : null;
}
