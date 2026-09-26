"use server";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { readRegistrationFields, registrationFieldSchema, registrationFileTypes, validateRegistrationFields, type RegistrationFieldConfig } from "@/features/events/registration-fields";
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
  return { ...current, fields: readRegistrationFields(current.fields), audited: current.status !== "DRAFT" || current._count.registrants > 0 };
}

async function saveForm(tx: Tx, access: Access, eventId: string, form: Awaited<ReturnType<typeof loadForm>>, fields: RegistrationFieldConfig[], fieldKey: string, change: FieldChange, adminAction: string, details: Record<string, string | number | boolean> = {}) {
  await tx.event.update({ where: { id: eventId }, data: { fields, fieldsVersion: { increment: 1 } } });
  if (requiresAdminAudit(access.membership)) await tx.auditLog.create({ data: { eventId, actorId: access.user.id, action: adminAction, target: fieldKey } });
  if (form.audited) {
    await tx.auditLog.create({ data: { eventId, actorId: access.user.id, action: "EVENT_FIELDS_CHANGED", target: fieldKey, metadata: { fieldKey, change, fieldsVersion: form.fieldsVersion + 1, ...details } } });
  }
}

const confirmed = (formData?: FormData) => formData?.get("confirmAnswers") === "on";

const newFieldInput = z.object({
  label: z.string().trim().min(1).max(191),
  type: z.enum(["text", "textarea", "email", "tel", "date", "select", "checkbox", "file"]),
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

  const options = ["select", "checkbox"].includes(parsed.data.type)
    ? parsed.data.optionsText.split(/\r?\n|,/).map((option) => option.trim()).filter(Boolean)
    : undefined;
  if (["select", "checkbox"].includes(parsed.data.type) && (
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
    const next = [...form.fields, field];
    if (form.fields.length >= 50 || !validateRegistrationFields(next) || !conditionDepthValid(next)) return false;
    await saveForm(tx, access, eventId, form, next, field.key, "added", "EVENT_FIELD_ADDED_BY_ADMIN", { type: field.type });
    return true;
  });

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
    if (!form.fields.some((field) => field.key === fieldKey)) return "invalid" as const;
    if (form.fields.some((field) => field.conditional?.field === fieldKey)) return "children" as const;
    const answered = (await countAnswersByField(eventId, [fieldKey], tx)).get(fieldKey) ?? 0;
    if (answered > 0 && !confirmed(formData)) return "confirm" as const;
    await saveForm(tx, access, eventId, form, form.fields.filter((field) => field.key !== fieldKey), fieldKey, "removed", "EVENT_FIELD_REMOVED_BY_ADMIN", { answered, answersKept: answered > 0 });
    return "ok" as const;
  });

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
    const fields = form.fields;
    const index = fields.findIndex((field) => field.key === fieldKey);
    if (index < 0) return "invalid" as const;
    const target = fields[index];
    // Keys and types are fixed for the life of a field so stored answers always keep their meaning.
    const requestedType = formData.get("type");
    if (typeof requestedType === "string" && requestedType && requestedType !== target.type) return "type" as const;
    const options = target.type === "select" || target.type === "checkbox"
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
    const next = [...fields];
    next[index] = {
      ...target, label: parsed.data.label, required: parsed.data.required, showOnCheckin: parsed.data.showOnCheckin, sensitive: parsed.data.sensitive, options, conditional,
      ...(target.type === "file" ? { acceptedFileTypes, maxFileSizeMb: parsed.data.maxFileSizeMb, maxFiles } : {}),
    };
    // Changing options or the condition must keep every child's condition pointing at existing parent options.
    if (!validateRegistrationFields(next) || !conditionDepthValid(next)) return "invalid" as const;
    if (JSON.stringify(next[index]) === JSON.stringify(target)) return "ok" as const;
    await saveForm(tx, access, eventId, form, next, fieldKey, "updated", "EVENT_FIELD_UPDATED_BY_ADMIN", {
      changed: (["label", "required", "showOnCheckin", "sensitive", "options", "conditional", "acceptedFileTypes", "maxFileSizeMb", "maxFiles"] as const)
        .filter((key) => JSON.stringify(next[index][key]) !== JSON.stringify(target[key])).join(","),
      ...(removedOptions.length ? { optionsRemoved: removedOptions.length, answered } : {}),
    });
    return "ok" as const;
  });
  if (updated === "confirm") redirect(`${back}&error=confirm-required&step=3`);
  if (updated === "type") redirect(`${back}&error=type-locked&step=3`);
  if (updated === "options") redirect(`${back}&error=invalid-options&step=3`);
  if (updated !== "ok") redirect(`${back}&error=invalid-field&step=3`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field&field=${encodeURIComponent(fieldKey)}`);
}

async function moveField(eventId: string, fieldKey: string, reorder: (fields: RegistrationFieldConfig[], index: number) => RegistrationFieldConfig[] | null) {
  const access = await requireEventAccess(eventId, "manage");
  const moved = await db.$transaction(async (tx) => {
    const form = await loadForm(tx, eventId);
    const index = form.fields.findIndex((field) => field.key === fieldKey);
    const next = index < 0 ? null : reorder([...form.fields], index);
    if (!next || !validateRegistrationFields(next)) return false;
    await saveForm(tx, access, eventId, form, next, fieldKey, "moved", "EVENT_FIELD_MOVED_BY_ADMIN");
    return true;
  });
  if (!moved) redirect(`/organizer/${eventId}?field=${encodeURIComponent(fieldKey)}&error=invalid-field&step=3`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field&field=${encodeURIComponent(fieldKey)}`);
}

export async function moveRegistrationField(eventId: string, fieldKey: string, direction: "up" | "down") {
  await moveField(eventId, fieldKey, (fields, index) => {
    const adjacent = index + (direction === "up" ? -1 : 1);
    if (adjacent < 0 || adjacent >= fields.length) return null;
    [fields[index], fields[adjacent]] = [fields[adjacent], fields[index]];
    return fields;
  });
}

export async function moveRegistrationFieldTo(eventId: string, fieldKey: string, targetIndex: number) {
  const parsedIndex = z.number().int().min(0).max(49).safeParse(targetIndex);
  if (!parsedIndex.success) redirect(`/organizer/${eventId}?error=invalid-field&step=3`);
  await moveField(eventId, fieldKey, (fields, index) => {
    if (parsedIndex.data >= fields.length) return null;
    const [field] = fields.splice(index, 1);
    fields.splice(parsedIndex.data, 0, field);
    return fields;
  });
}
