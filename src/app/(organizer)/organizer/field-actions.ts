"use server";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fieldsOf, formPageBreakSchema, isPageBreak, MAX_FORM_FIELDS, MAX_FORM_PAGE_BREAKS, readRegistrationForm, registrationFieldSchema, registrationFileTypes, validateRegistrationFields, type RegistrationFieldConfig, type RegistrationFormItem } from "@/features/events/registration-fields";
import { displayNameRulesKey, registrantDisplayName } from "@/features/registrations/display-name";
import { requireEventAccess } from "@/server/authorization/event";
import { requiresAdminAudit } from "@/server/authorization/policy";
import { db } from "@/server/db";
import { countAnswersByField } from "@/server/events/field-answers";

/*
 * Form rules (spec 1.4, decided 26 Sep): the form stays editable after publishing and after people registered.
 * - Adding, relabelling, reordering and toggling required / showOnCheckin / sensitive are always allowed.
 * - Keys and types never change. Stored answers are never deleted: an answer whose option or field is removed
 *   stays in `answers` as an orphan, so removing/renaming options of, or deleting, a field that has answers
 *   needs an explicit `confirmAnswers=on`.
 * - A parent field cannot be deleted while conditional children point at it, and its options cannot drop a value
 *   a child's condition uses; change the children first.
 * - Page breaks are items in the same ordered list (type "page"): they only split the public wizard into pages and
 *   never hold answers, so they are added, renamed, moved and removed freely. `form.items` is the stored list,
 *   `form.fields` the answerable fields in it.
 * - Every change bumps `fieldsVersion`. Once the event is published or has registrants, each change is audited
 *   as EVENT_FIELDS_CHANGED with the field key and kind of change only (never answer values).
 */

const allowedFileTypes: readonly string[] = registrationFileTypes;
type Tx = Prisma.TransactionClient;
type Access = Awaited<ReturnType<typeof requireEventAccess>>;
type FieldChange = "added" | "updated" | "removed" | "moved";

/** Reads condition settings; several allowed values use "in" so both select and checkbox parents match. */
function readCondition(formData: FormData) {
  const field = formData.get("conditionField");
  if (typeof field !== "string" || !field) return undefined;
  const values = formData.getAll("conditionValues").filter((value): value is string => typeof value === "string" && !!value);
  const legacy = formData.get("conditionValue");
  if (!values.length && typeof legacy === "string" && legacy.trim()) return { field, operator: "equals" as const, value: legacy.trim() };
  if (!values.length || values.length > 30) return null;
  return values.length === 1 ? { field, operator: "equals" as const, value: values[0] } : { field, operator: "in" as const, value: values };
}

/** Accepts file types from checkbox chips or the legacy comma/line separated text. */
function readFileTypes(formData: FormData, text: string) {
  const chips = formData.getAll("acceptedFileTypes").filter((value): value is string => typeof value === "string");
  const raw = chips.length ? chips : text.split(/[\r\n,]+/);
  const types = raw.map((type) => type.trim().toLowerCase().replace(/^\./, "")).filter(Boolean);
  if (!types.length || types.length > allowedFileTypes.length || new Set(types).size !== types.length || types.some((type) => !allowedFileTypes.includes(type))) return null;
  return types;
}

/** "1" or missing keeps the single-file answer shape; "3" lets registrants attach up to three files. */
function readMaxFiles(formData: FormData) {
  const value = formData.get("maxFiles");
  if (value === null || value === "" || value === "1") return 1 as const;
  return value === "3" ? 3 as const : null;
}

/** Conditional fields are one level deep: a child may not itself be a parent. */
function conditionDepthValid(fields: RegistrationFieldConfig[]) {
  const children = new Set(fields.filter((field) => field.conditional).map((field) => field.key));
  return fields.every((field) => !field.conditional || !children.has(field.conditional.field));
}

async function loadForm(tx: Tx, eventId: string) {
  // Lock the event row so two editors cannot interleave schema changes and version bumps.
  await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
  const current = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true, fields: true, fieldsVersion: true, _count: { select: { registrants: true } } } });
  const items = readRegistrationForm(current.fields);
  return { ...current, items, fields: fieldsOf(items), audited: current.status !== "DRAFT" || current._count.registrants > 0 };
}

/** Field rules apply to the answerable fields in list order; page breaks in between do not matter. */
const formValid = (items: RegistrationFormItem[]) => validateRegistrationFields(fieldsOf(items)) && conditionDepthValid(fieldsOf(items));

async function saveForm(tx: Tx, access: Access, eventId: string, form: Awaited<ReturnType<typeof loadForm>>, items: RegistrationFormItem[], fieldKey: string, change: FieldChange, adminAction: string, details: Record<string, string | number | boolean> = {}) {
  const fields = fieldsOf(items);
  await tx.event.update({ where: { id: eventId }, data: { fields: items, fieldsVersion: { increment: 1 } } });
  if (form._count.registrants && displayNameRulesKey(form.fields) !== displayNameRulesKey(fields)) await refreshDisplayNames(tx, eventId, fields);
  if (requiresAdminAudit(access.membership)) await tx.auditLog.create({ data: { eventId, actorId: access.user.id, action: adminAction, target: fieldKey } });
  if (form.audited) {
    await tx.auditLog.create({ data: { eventId, actorId: access.user.id, action: "EVENT_FIELDS_CHANGED", target: fieldKey, metadata: { fieldKey, change, fieldsVersion: form.fieldsVersion + 1, ...details } } });
  }
}

/** Re-derives stored registrant names after a form change that affects them (e.g. the name field was relabelled). */
async function refreshDisplayNames(tx: Tx, eventId: string, fields: RegistrationFieldConfig[]) {
  let cursor: string | undefined;
  for (;;) {
    const rows = await tx.registrant.findMany({ where: { eventId, anonymizedAt: null }, select: { id: true, answers: true, displayName: true }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (!rows.length) return;
    for (const row of rows) {
      const next = registrantDisplayName(fields, row.answers);
      if (next !== row.displayName) await tx.registrant.update({ where: { id: row.id }, data: { displayName: next } });
    }
    cursor = rows.at(-1)!.id;
  }
}

// Room for refreshDisplayNames on large events (Prisma interactive transactions default to 5 s).
const FORM_TX = { timeout: 30_000 };

const confirmed = (formData?: FormData) => formData?.get("confirmAnswers") === "on";

const newFieldInput = z.object({
  label: z.string().trim().min(1).max(191),
  type: z.enum(["text", "textarea", "email", "tel", "date", "select", "radio", "checkbox", "file"]),
  required: z.boolean(),
  showOnCheckin: z.boolean(),
  sensitive: z.boolean(),
  optionsText: z.string().max(3000),
  conditionField: z.string().max(191),
  conditionValue: z.string().max(191),
  maxFileSizeMb: z.coerce.number().int().min(1).max(5),
});

export async function addRegistrationField(eventId: string, formData: FormData) {
  const access = await requireEventAccess(eventId, "manage");
  const back = `/organizer/${eventId}?field=__new__`;

  const parsed = newFieldInput.safeParse({
    label: formData.get("label"),
    type: formData.get("type"),
    required: formData.get("required") === "on",
    showOnCheckin: formData.get("showOnCheckin") === "on",
    sensitive: formData.get("sensitive") === "on",
    optionsText: formData.get("optionsText") ?? "",
    conditionField: formData.get("conditionField") ?? "",
    conditionValue: formData.get("conditionValue") ?? "",
    maxFileSizeMb: formData.get("maxFileSizeMb") ?? "5",
  });
  if (!parsed.success) redirect(`${back}&error=invalid-field&step=3`);

  const options = ["select", "radio", "checkbox"].includes(parsed.data.type)
    ? parsed.data.optionsText.split(/\r?\n|,/).map((option) => option.trim()).filter(Boolean)
    : undefined;
  if (["select", "radio", "checkbox"].includes(parsed.data.type) && (
    !options || options.length < 2 || options.length > 30 ||
    new Set(options).size !== options.length || options.some((option) => option.length > 191)
  )) redirect(`${back}&error=invalid-options&step=3`);

  const acceptedFileTypes = parsed.data.type === "file" ? readFileTypes(formData, parsed.data.optionsText) : undefined;
  const maxFiles = parsed.data.type === "file" ? readMaxFiles(formData) : undefined;
  if (acceptedFileTypes === null || maxFiles === null) redirect(`${back}&error=invalid-options&step=3`);
  const conditional = readCondition(formData);
  if (conditional === null) redirect(`${back}&error=invalid-condition&step=3`);

  const field = registrationFieldSchema.parse({
    key: `field_${randomUUID().replaceAll("-", "")}`,
    label: parsed.data.label,
    type: parsed.data.type,
    required: parsed.data.required,
    showOnCheckin: parsed.data.showOnCheckin,
    sensitive: parsed.data.sensitive,
    options,
    acceptedFileTypes,
    maxFileSizeMb: parsed.data.type === "file" ? parsed.data.maxFileSizeMb : undefined,
    maxFiles,
    conditional,
  });

  const updated = await db.$transaction(async (tx) => {
    const form = await loadForm(tx, eventId);
    const next = [...form.items, field];
    if (form.fields.length >= MAX_FORM_FIELDS || !formValid(next)) return false;
    await saveForm(tx, access, eventId, form, next, field.key, "added", "EVENT_FIELD_ADDED_BY_ADMIN", { type: field.type });
    return true;
  }, FORM_TX);

  if (!updated) redirect(`${back}&error=invalid-field&step=3`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field&field=${field.key}`);
}

/** Deletes a field from the form. Stored answers stay in `answers`; a field that has answers needs `confirmAnswers`. */
export async function removeRegistrationField(eventId: string, fieldKey: string, formData?: FormData) {
  const access = await requireEventAccess(eventId, "manage");
  const back = `/organizer/${eventId}?field=${encodeURIComponent(fieldKey)}`;

  const removed = await db.$transaction(async (tx) => {
    const form = await loadForm(tx, eventId);
    const target = form.items.find((item) => item.key === fieldKey);
    if (!target) return "invalid" as const;
    const next = form.items.filter((item) => item.key !== fieldKey);
    if (isPageBreak(target)) {
      await saveForm(tx, access, eventId, form, next, fieldKey, "removed", "EVENT_FIELD_REMOVED_BY_ADMIN", { type: "page" });
      return "ok" as const;
    }
    if (form.fields.some((field) => field.conditional?.field === fieldKey)) return "children" as const;
    const answered = (await countAnswersByField(eventId, [fieldKey], tx)).get(fieldKey) ?? 0;
    if (answered > 0 && !confirmed(formData)) return "confirm" as const;
    await saveForm(tx, access, eventId, form, next, fieldKey, "removed", "EVENT_FIELD_REMOVED_BY_ADMIN", { answered, answersKept: answered > 0 });
    return "ok" as const;
  }, FORM_TX);

  if (removed === "children") redirect(`${back}&error=field-has-children&step=3`);
  if (removed === "confirm") redirect(`${back}&error=confirm-required&step=3`);
  if (removed !== "ok") redirect(`/organizer/${eventId}?error=invalid-field&step=3`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field`);
}

export async function updateRegistrationField(eventId: string, fieldKey: string, formData: FormData) {
  const access = await requireEventAccess(eventId, "manage");
  const parsed = z.object({
    label: z.string().trim().min(1).max(191),
    optionsText: z.string().max(3000),
    required: z.boolean(),
    showOnCheckin: z.boolean(),
    sensitive: z.boolean(),
    maxFileSizeMb: z.coerce.number().int().min(1).max(5),
  }).safeParse({
    label: formData.get("label"), optionsText: formData.get("optionsText") ?? "", required: formData.get("required") === "on",
    showOnCheckin: formData.get("showOnCheckin") === "on", sensitive: formData.get("sensitive") === "on", maxFileSizeMb: formData.get("maxFileSizeMb") ?? "5",
  });
  const conditional = readCondition(formData);
  const back = `/organizer/${eventId}?field=${encodeURIComponent(fieldKey)}`;
  if (conditional === null) redirect(`${back}&error=invalid-condition&step=3`);
  if (!parsed.success) redirect(`${back}&error=invalid-field&step=3`);
  const updated = await db.$transaction(async (tx) => {
    const form = await loadForm(tx, eventId);
    const index = form.items.findIndex((item) => item.key === fieldKey);
    const target = form.items[index];
    if (!target || isPageBreak(target)) return "invalid" as const;
    // Keys and types are fixed for the life of a field so stored answers always keep their meaning.
    const requestedType = formData.get("type");
    if (typeof requestedType === "string" && requestedType && requestedType !== target.type) return "type" as const;
    const options = target.type === "select" || target.type === "radio" || target.type === "checkbox"
      ? parsed.data.optionsText.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean)
      : undefined;
    if (options && (options.length < 2 || options.length > 30 || new Set(options).size !== options.length || options.some((value) => value.length > 191))) return "options" as const;
    const acceptedFileTypes = target.type === "file" ? readFileTypes(formData, "") : undefined;
    const maxFiles = target.type === "file" ? readMaxFiles(formData) : undefined;
    if (acceptedFileTypes === null || maxFiles === null) return "options" as const;
    // Removing or renaming an option orphans answers that used it: ask first when anyone has answered.
    const removedOptions = (target.options ?? []).filter((option) => !options?.includes(option));
    const answered = removedOptions.length ? (await countAnswersByField(eventId, [fieldKey], tx)).get(fieldKey) ?? 0 : 0;
    if (answered > 0 && !confirmed(formData)) return "confirm" as const;
    const updatedField: RegistrationFieldConfig = {
      ...target, label: parsed.data.label, required: parsed.data.required, showOnCheckin: parsed.data.showOnCheckin, sensitive: parsed.data.sensitive, options, conditional,
      ...(target.type === "file" ? { acceptedFileTypes, maxFileSizeMb: parsed.data.maxFileSizeMb, maxFiles } : {}),
    };
    const next = [...form.items];
    next[index] = updatedField;
    // Changing options or the condition must keep every child's condition pointing at existing parent options.
    if (!formValid(next)) return "invalid" as const;
    if (JSON.stringify(updatedField) === JSON.stringify(target)) return "ok" as const;
    await saveForm(tx, access, eventId, form, next, fieldKey, "updated", "EVENT_FIELD_UPDATED_BY_ADMIN", {
      changed: (["label", "required", "showOnCheckin", "sensitive", "options", "conditional", "acceptedFileTypes", "maxFileSizeMb", "maxFiles"] as const)
        .filter((key) => JSON.stringify(updatedField[key]) !== JSON.stringify(target[key])).join(","),
      ...(removedOptions.length ? { optionsRemoved: removedOptions.length, answered } : {}),
    });
    return "ok" as const;
  }, FORM_TX);
  if (updated === "confirm") redirect(`${back}&error=confirm-required&step=3`);
  if (updated === "type") redirect(`${back}&error=type-locked&step=3`);
  if (updated === "options") redirect(`${back}&error=invalid-options&step=3`);
  if (updated !== "ok") redirect(`${back}&error=invalid-field&step=3`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field&field=${encodeURIComponent(fieldKey)}`);
}

async function moveField(eventId: string, fieldKey: string, reorder: (items: RegistrationFormItem[], index: number) => RegistrationFormItem[] | null) {
  const access = await requireEventAccess(eventId, "manage");
  const moved = await db.$transaction(async (tx) => {
    const form = await loadForm(tx, eventId);
    const index = form.items.findIndex((item) => item.key === fieldKey);
    const next = index < 0 ? null : reorder([...form.items], index);
    if (!next || !validateRegistrationFields(fieldsOf(next))) return false;
    await saveForm(tx, access, eventId, form, next, fieldKey, "moved", "EVENT_FIELD_MOVED_BY_ADMIN");
    return true;
  }, FORM_TX);
  if (!moved) redirect(`/organizer/${eventId}?field=${encodeURIComponent(fieldKey)}&error=invalid-field&step=3`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field&field=${encodeURIComponent(fieldKey)}`);
}

export async function moveRegistrationField(eventId: string, fieldKey: string, direction: "up" | "down") {
  await moveField(eventId, fieldKey, (items, index) => {
    const adjacent = index + (direction === "up" ? -1 : 1);
    if (adjacent < 0 || adjacent >= items.length) return null;
    [items[index], items[adjacent]] = [items[adjacent], items[index]];
    return items;
  });
}

export async function moveRegistrationFieldTo(eventId: string, fieldKey: string, targetIndex: number) {
  const parsedIndex = z.number().int().min(0).max(MAX_FORM_FIELDS + MAX_FORM_PAGE_BREAKS - 1).safeParse(targetIndex);
  if (!parsedIndex.success) redirect(`/organizer/${eventId}?error=invalid-field&step=3`);
  await moveField(eventId, fieldKey, (items, index) => {
    if (parsedIndex.data >= items.length) return null;
    const [item] = items.splice(index, 1);
    items.splice(parsedIndex.data, 0, item);
    return items;
  });
}

const pageLabelInput = z.string().trim().max(191);

/** Appends a page break; the organizer then drags it to where the next page should start. */
export async function addFormPageBreak(eventId: string, formData: FormData) {
  const access = await requireEventAccess(eventId, "manage");
  const label = pageLabelInput.safeParse(formData.get("label") ?? "");
  if (!label.success) redirect(`/organizer/${eventId}?error=invalid-field&step=3`);
  const page = formPageBreakSchema.parse({ key: `page_${randomUUID().replaceAll("-", "")}`, type: "page", label: label.data });
  const added = await db.$transaction(async (tx) => {
    const form = await loadForm(tx, eventId);
    if (form.items.filter(isPageBreak).length >= MAX_FORM_PAGE_BREAKS) return false;
    await saveForm(tx, access, eventId, form, [...form.items, page], page.key, "added", "EVENT_FIELD_ADDED_BY_ADMIN", { type: "page" });
    return true;
  }, FORM_TX);
  if (!added) redirect(`/organizer/${eventId}?error=too-many-pages&step=3`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field&field=${page.key}`);
}

export async function updateFormPageBreak(eventId: string, pageKey: string, formData: FormData) {
  const access = await requireEventAccess(eventId, "manage");
  const back = `/organizer/${eventId}?field=${encodeURIComponent(pageKey)}`;
  const label = pageLabelInput.safeParse(formData.get("label") ?? "");
  if (!label.success) redirect(`${back}&error=invalid-field&step=3`);
  const updated = await db.$transaction(async (tx) => {
    const form = await loadForm(tx, eventId);
    const index = form.items.findIndex((item) => item.key === pageKey);
    const target = form.items[index];
    if (!target || !isPageBreak(target)) return false;
    if (target.label === label.data) return true;
    const next = [...form.items];
    next[index] = { ...target, label: label.data };
    await saveForm(tx, access, eventId, form, next, pageKey, "updated", "EVENT_FIELD_UPDATED_BY_ADMIN", { type: "page", changed: "label" });
    return true;
  }, FORM_TX);
  if (!updated) redirect(`${back}&error=invalid-field&step=3`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field&field=${encodeURIComponent(pageKey)}`);
}
