import { z } from "zod";

const conditionalRuleSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["equals", "in", "includes"]),
  value: z.union([z.string(), z.array(z.string())]),
});

export const registrationFieldSchema = z.object({
  key: z.string().min(1).max(191),
  label: z.string().trim().min(1).max(191),
  type: z.enum(["text", "textarea", "email", "tel", "date", "select", "radio", "checkbox", "file"]),
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

/**
 * A page break in the stored form: the fields after it go on the next page of the public wizard. It is layout only —
 * it never has an answer, so `readRegistrationFields` drops it and everything that stores, validates, lists or
 * exports answers is unaware of pages.
 */
export const formPageBreakSchema = z.object({
  key: z.string().min(1).max(191),
  type: z.literal("page"),
  /** Page title shown in the wizard; empty uses the default title. */
  label: z.string().trim().max(191),
});

export const MAX_FORM_FIELDS = 50;
export const MAX_FORM_PAGE_BREAKS = 10;
const registrationFormSchema = z.array(z.union([formPageBreakSchema, registrationFieldSchema])).max(MAX_FORM_FIELDS + MAX_FORM_PAGE_BREAKS);

export type RegistrationFieldConfig = z.infer<typeof registrationFieldSchema>;
export type FormPageBreak = z.infer<typeof formPageBreakSchema>;
export type RegistrationFormItem = RegistrationFieldConfig | FormPageBreak;
export type FormPage = { title: string; fields: RegistrationFieldConfig[] };
/** Page layout handed to client forms: titles and field keys only. */
export type FormPageLayout = { title: string; keys: string[] };
export const DEFAULT_FORM_PAGE_TITLE = "ข้อมูลผู้ลงทะเบียน";

export const isPageBreak = (item: RegistrationFormItem): item is FormPageBreak => item.type === "page";
export const fieldsOf = (items: RegistrationFormItem[]) => items.filter((item): item is RegistrationFieldConfig => !isPageBreak(item));
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

/** The stored form in order, page breaks included. Only the form builder and the page layout need this. */
export function readRegistrationForm(value: unknown): RegistrationFormItem[] {
  const parsed = registrationFormSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid event registration field configuration");
  return parsed.data;
}

/** The answerable fields in order (page breaks removed). */
export function readRegistrationFields(value: unknown): RegistrationFieldConfig[] {
  return fieldsOf(readRegistrationForm(value));
}

/**
 * Splits the form into wizard pages. A break starts a new page titled by its label; pages left without fields
 * (a leading, trailing or doubled break) are dropped, so a leading break simply titles the first page.
 */
export function formPages(items: RegistrationFormItem[]): FormPage[] {
  const pages: FormPage[] = [{ title: "", fields: [] }];
  for (const item of items) {
    if (isPageBreak(item)) pages.push({ title: item.label, fields: [] });
    else pages.at(-1)!.fields.push(item);
  }
  return pages.filter((page) => page.fields.length > 0);
}

export const formPageLayout = (items: RegistrationFormItem[]): FormPageLayout[] =>
  formPages(items).map((page) => ({ title: page.title, keys: page.fields.map((field) => field.key) }));

/**
 * For forms that stay on one screen (walk-in, self-edit): the heading to print above a field because it is the
 * first visible field of its page. Empty for a form without page breaks.
 */
export function sectionHeadings(pages: FormPageLayout[], visibleKeys: string[]) {
  const headings = new Map<string, string>();
  if (pages.length < 2) return headings;
  const visible = new Set(visibleKeys);
  for (const page of pages) {
    const first = page.keys.find((key) => visible.has(key));
    if (first) headings.set(first, page.title || DEFAULT_FORM_PAGE_TITLE);
  }
  return headings;
}

export function validateRegistrationFields(fields: RegistrationFieldConfig[]) {
  if (fields.length === 0) return false;
  const seen = new Map<string, RegistrationFieldConfig>();
  for (const field of fields) {
    if (seen.has(field.key)) return false;
    if (field.showOnCheckin && (field.sensitive || field.type === "file")) return false;
    if ((field.type === "select" || field.type === "radio" || field.type === "checkbox") && (!field.options?.length || new Set(field.options).size !== field.options.length)) return false;
    if (field.type === "file" && (!field.acceptedFileTypes?.length || field.acceptedFileTypes.some((type) => !(registrationFileTypes as readonly string[]).includes(type.toLowerCase().replace(/^\./, ""))) || !field.maxFileSizeMb || field.maxFileSizeMb > 5)) return false;
    if (field.conditional) {
      const parent = seen.get(field.conditional.field);
      if (!parent || !["select", "radio", "checkbox"].includes(parent.type)) return false;
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
 * Phone answers: digits, spaces and + - ( ) . only, 6–30 characters. The same rule runs in the browser (`pattern`),
 * which compiles it with the `v` flag — there ( ) and - must be escaped inside a character class.
 */
export const TEL_ANSWER_PATTERN = "[+0-9\\(\\) .\\-]{6,30}";
const telAnswer = new RegExp(`^${TEL_ANSWER_PATTERN}$`);

/** The single limit before 5 Oct 2026; stored answers up to this length stay valid when sent back unchanged. */
const LEGACY_ANSWER_MAX_LENGTH = 3000;

/** Longest answer per field type (spec A6): long text 5,000, phone 30 (its pattern), everything else 500. Browser and server share it. */
export function answerMaxLength(type: RegistrationFieldConfig["type"]) {
  return type === "textarea" ? 5000 : type === "tel" ? 30 : 500;
}

/** What to tell the person filling the form in: which field, and what it expects. */
export function answerProblemMessage(field: Pick<RegistrationFieldConfig, "label" | "type">, reason: AnswerProblem["reason"]) {
  if (reason === "required") return `กรุณากรอก “${field.label}”`;
  const expected = field.type === "tel" ? "ต้องเป็นเบอร์โทรศัพท์ 6–30 ตัว ใช้ได้เฉพาะตัวเลข เว้นวรรค และ + - ( )"
    : field.type === "email" ? "ต้องเป็นอีเมล เช่น name@example.com"
    : field.type === "date" ? "ต้องเป็นวันที่"
    : field.type === "select" || field.type === "radio" || field.type === "checkbox" ? "ต้องเลือกจากตัวเลือกที่มี"
    : field.type === "file" ? "ไฟล์ไม่ถูกต้อง"
    : `ยาวได้ไม่เกิน ${answerMaxLength(field.type).toLocaleString("en-US")} ตัวอักษร`;
  return `“${field.label}” ${expected}`;
}

/**
 * Validates submitted answers against the form. On failure returns which field failed and why, so the form can
 * say more than "invalid" (`fieldKey` is null when the form configuration itself is broken).
 * `previous` (self-edit, check-in corrections) holds the stored answers: one sent back unchanged is not held to
 * the length limit, so answers saved under the old 3,000-character limit do not block editing other fields.
 */
export function checkRegistrationAnswers(fields: RegistrationFieldConfig[], formData: FormData, uploads: Record<string, RegistrationFileAnswer | RegistrationFileAnswer[]> = {}, previous: Record<string, unknown> = {}): { answers: Record<string, RegistrationAnswerValue> } | { problem: AnswerProblem } {
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
    if (value.length > answerMaxLength(field.type) && !(value.length <= LEGACY_ANSWER_MAX_LENGTH && value === previous[field.key])) return fail(field, "invalid");
    if ((field.type === "select" || field.type === "radio") && value && !field.options?.includes(value)) return fail(field, "invalid");
    if (field.type === "email" && value && !z.email().safeParse(value).success) return fail(field, "invalid");
    if (field.type === "tel" && value && !telAnswer.test(value)) return fail(field, "invalid");
    if (field.type === "date" && value && !z.iso.date().safeParse(value).success) return fail(field, "invalid");
    answers[field.key] = value;
  }

  return { answers };
}

export function parseRegistrationAnswers(fields: RegistrationFieldConfig[], formData: FormData, uploads: Record<string, RegistrationFileAnswer | RegistrationFileAnswer[]> = {}) {
  const result = checkRegistrationAnswers(fields, formData, uploads);
  return "answers" in result ? result.answers : null;
}
