"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { readRegistrationFields, registrationFieldSchema, validateRegistrationFields, type RegistrationFieldConfig } from "@/features/events/registration-fields";
import { requireEventAccess } from "@/server/authorization/event";
import { requiresAdminAudit } from "@/server/authorization/policy";
import { db } from "@/server/db";

const allowedFileTypes = ["pdf", "jpg", "jpeg", "png", "webp"];

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
  if (!types.length || types.length > 5 || new Set(types).size !== types.length || types.some((type) => !allowedFileTypes.includes(type))) return null;
  return types;
}

/** Conditional fields are one level deep: a child may not itself be a parent. */
function conditionDepthValid(fields: RegistrationFieldConfig[]) {
  const children = new Set(fields.filter((field) => field.conditional).map((field) => field.key));
  return fields.every((field) => !field.conditional || !children.has(field.conditional.field));
}

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
  const { event, membership, user } = await requireEventAccess(eventId, "manage");
  if (event.status !== "DRAFT") redirect(`/organizer/${eventId}?field=__new__&error=fields-locked`);

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
  if (!parsed.success) redirect(`/organizer/${eventId}?field=__new__&error=invalid-field`);

  const options = ["select", "checkbox"].includes(parsed.data.type)
    ? parsed.data.optionsText.split(/\r?\n|,/).map((option) => option.trim()).filter(Boolean)
    : undefined;
  if (["select", "checkbox"].includes(parsed.data.type) && (
    !options || options.length < 2 || options.length > 30 ||
    new Set(options).size !== options.length || options.some((option) => option.length > 191)
  )) redirect(`/organizer/${eventId}?field=__new__&error=invalid-options`);

  const acceptedFileTypes = parsed.data.type === "file" ? readFileTypes(formData, parsed.data.optionsText) : undefined;
  if (acceptedFileTypes === null) redirect(`/organizer/${eventId}?field=__new__&error=invalid-options`);
  const conditional = readCondition(formData);
  if (conditional === null) redirect(`/organizer/${eventId}?field=__new__&error=invalid-condition`);

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
    conditional,
  });

  const updated = await db.$transaction(async (tx) => {
    const current = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true, fields: true } });
    if (current.status !== "DRAFT") return false;
    const fields = readRegistrationFields(current.fields);
    if (fields.length >= 50 || !validateRegistrationFields([...fields, field]) || !conditionDepthValid([...fields, field])) return false;
    await tx.event.update({ where: { id: eventId }, data: { fields: [...fields, field], fieldsVersion: { increment: 1 } } });
    if (requiresAdminAudit(membership)) {
      await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "EVENT_FIELD_ADDED_BY_ADMIN", target: field.key } });
    }
    return true;
  });

  if (!updated) redirect(`/organizer/${eventId}?field=__new__&error=invalid-field`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field&field=${field.key}`);
}

export async function removeRegistrationField(eventId: string, fieldKey: string) {
  const { event, membership, user } = await requireEventAccess(eventId, "manage");
  if (event.status !== "DRAFT") redirect(`/organizer/${eventId}?error=fields-locked`);

  const removed = await db.$transaction(async (tx) => {
    const current = await tx.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { status: true, fields: true, _count: { select: { registrants: true } } },
    });
    if (current.status !== "DRAFT" || current._count.registrants > 0) return false;
    const fields = readRegistrationFields(current.fields);
    if (!fields.some((field) => field.key === fieldKey)) return false;
    if (fields.some((field) => field.conditional?.field === fieldKey)) return false;
    await tx.event.update({
      where: { id: eventId },
      data: { fields: fields.filter((field) => field.key !== fieldKey), fieldsVersion: { increment: 1 } },
    });
    if (requiresAdminAudit(membership)) {
      await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "EVENT_FIELD_REMOVED_BY_ADMIN", target: fieldKey } });
    }
    return true;
  });

  if (!removed) redirect(`/organizer/${eventId}?error=field-in-use`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field`);
}

export async function updateRegistrationField(eventId: string, fieldKey: string, formData: FormData) {
  const { membership, user } = await requireEventAccess(eventId, "manage");
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
  if (conditional === null) redirect(`${back}&error=invalid-condition`);
  if (!parsed.success) redirect(`${back}&error=invalid-field`);
  const updated = await db.$transaction(async (tx) => {
    const current = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true, fields: true, _count: { select: { registrants: true } } } });
    if (current.status !== "DRAFT" || current._count.registrants > 0) return "locked" as const;
    const fields = readRegistrationFields(current.fields);
    const index = fields.findIndex((field) => field.key === fieldKey);
    if (index < 0) return "invalid" as const;
    const target = fields[index];
    const options = target.type === "select" || target.type === "checkbox"
      ? parsed.data.optionsText.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean)
      : undefined;
    if (options && (options.length < 2 || options.length > 30 || new Set(options).size !== options.length || options.some((value) => value.length > 191))) return "options" as const;
    const acceptedFileTypes = target.type === "file" ? readFileTypes(formData, "") : undefined;
    if (acceptedFileTypes === null) return "options" as const;
    const next = [...fields];
    next[index] = {
      ...target, label: parsed.data.label, required: parsed.data.required, showOnCheckin: parsed.data.showOnCheckin, sensitive: parsed.data.sensitive, options, conditional,
      ...(target.type === "file" ? { acceptedFileTypes, maxFileSizeMb: parsed.data.maxFileSizeMb } : {}),
    };
    // Changing options or the condition must keep every child's condition pointing at existing parent options.
    if (!validateRegistrationFields(next) || !conditionDepthValid(next)) return "invalid" as const;
    await tx.event.update({ where: { id: eventId }, data: { fields: next, fieldsVersion: { increment: 1 } } });
    if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "EVENT_FIELD_UPDATED_BY_ADMIN", target: fieldKey } });
    return "ok" as const;
  });
  if (updated === "locked") redirect(`${back}&error=fields-locked`);
  if (updated === "options") redirect(`${back}&error=invalid-options`);
  if (updated !== "ok") redirect(`${back}&error=invalid-field`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field&field=${encodeURIComponent(fieldKey)}`);
}

export async function moveRegistrationField(eventId: string, fieldKey: string, direction: "up" | "down") {
  const { membership, user } = await requireEventAccess(eventId, "manage");
  const moved = await db.$transaction(async (tx) => {
    const current = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true, fields: true, _count: { select: { registrants: true } } } });
    if (current.status !== "DRAFT" || current._count.registrants > 0) return false;
    const fields = readRegistrationFields(current.fields);
    const index = fields.findIndex((field) => field.key === fieldKey);
    const adjacent = index + (direction === "up" ? -1 : 1);
    if (index < 0 || adjacent < 0 || adjacent >= fields.length) return false;
    [fields[index], fields[adjacent]] = [fields[adjacent], fields[index]];
    if (!validateRegistrationFields(fields)) return false;
    await tx.event.update({ where: { id: eventId }, data: { fields, fieldsVersion: { increment: 1 } } });
    if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "EVENT_FIELD_MOVED_BY_ADMIN", target: fieldKey } });
    return true;
  });
  if (!moved) redirect(`/organizer/${eventId}?field=${encodeURIComponent(fieldKey)}&error=invalid-field`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field&field=${encodeURIComponent(fieldKey)}`);
}

export async function moveRegistrationFieldTo(eventId: string, fieldKey: string, targetIndex: number) {
  const { membership, user } = await requireEventAccess(eventId, "manage");
  const parsedIndex = z.number().int().min(0).max(49).safeParse(targetIndex);
  if (!parsedIndex.success) redirect(`/organizer/${eventId}?error=invalid-field`);

  const moved = await db.$transaction(async (tx) => {
    const current = await tx.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { status: true, fields: true, _count: { select: { registrants: true } } },
    });
    if (current.status !== "DRAFT" || current._count.registrants > 0) return false;
    const fields = readRegistrationFields(current.fields);
    const sourceIndex = fields.findIndex((field) => field.key === fieldKey);
    if (sourceIndex < 0 || parsedIndex.data >= fields.length) return false;

    const next = [...fields];
    const [field] = next.splice(sourceIndex, 1);
    next.splice(parsedIndex.data, 0, field);
    if (!validateRegistrationFields(next)) return false;

    await tx.event.update({ where: { id: eventId }, data: { fields: next, fieldsVersion: { increment: 1 } } });
    if (requiresAdminAudit(membership)) {
      await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "EVENT_FIELD_MOVED_BY_ADMIN", target: fieldKey } });
    }
    return true;
  });

  if (!moved) redirect(`/organizer/${eventId}?field=${encodeURIComponent(fieldKey)}&error=invalid-field`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field&field=${encodeURIComponent(fieldKey)}`);
}
