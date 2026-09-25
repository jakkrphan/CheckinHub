"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { readRegistrationFields, registrationFieldSchema, validateRegistrationFields } from "@/features/events/registration-fields";
import { requireEventAccess } from "@/server/authorization/event";
import { requiresAdminAudit } from "@/server/authorization/policy";
import { db } from "@/server/db";

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
  if (event.status !== "DRAFT") redirect(`/organizer/${eventId}?error=fields-locked`);

  const parsed = newFieldInput.safeParse({
    label: formData.get("label"),
    type: formData.get("type"),
    required: formData.get("required") === "on",
    showOnCheckin: formData.get("showOnCheckin") === "on",
    sensitive: formData.get("sensitive") === "on",
    optionsText: formData.get("optionsText"),
    conditionField: formData.get("conditionField") ?? "",
    conditionValue: formData.get("conditionValue") ?? "",
    maxFileSizeMb: formData.get("maxFileSizeMb") ?? "5",
  });
  if (!parsed.success) redirect(`/organizer/${eventId}?error=invalid-field`);

  const options = ["select", "checkbox"].includes(parsed.data.type)
    ? parsed.data.optionsText.split(/\r?\n|,/).map((option) => option.trim()).filter(Boolean)
    : undefined;
  if (["select", "checkbox"].includes(parsed.data.type) && (
    !options || options.length < 2 || options.length > 30 ||
    new Set(options).size !== options.length || options.some((option) => option.length > 191)
  )) redirect(`/organizer/${eventId}?error=invalid-options`);

  const acceptedFileTypes = parsed.data.type === "file"
    ? parsed.data.optionsText.split(/[\r\n,]+/).map((type) => type.trim().toLowerCase().replace(/^\./, "")).filter(Boolean)
    : undefined;
  if (parsed.data.type === "file" && (!acceptedFileTypes?.length || acceptedFileTypes.length > 5 || new Set(acceptedFileTypes).size !== acceptedFileTypes.length || acceptedFileTypes.some((type) => !["pdf", "jpg", "jpeg", "png", "webp"].includes(type)))) redirect(`/organizer/${eventId}?error=invalid-options`);

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
    conditional: parsed.data.conditionField ? { field: parsed.data.conditionField, operator: "equals", value: parsed.data.conditionValue } : undefined,
  });

  const updated = await db.$transaction(async (tx) => {
    const current = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true, fields: true } });
    if (current.status !== "DRAFT") return false;
    const fields = readRegistrationFields(current.fields);
    if (fields.length >= 50 || !validateRegistrationFields([...fields, field])) return false;
    await tx.event.update({ where: { id: eventId }, data: { fields: [...fields, field], fieldsVersion: { increment: 1 } } });
    if (requiresAdminAudit(membership)) {
      await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "EVENT_FIELD_ADDED_BY_ADMIN", target: field.key } });
    }
    return true;
  });

  if (!updated) redirect(`/organizer/${eventId}?error=fields-locked`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field`);
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
  const parsed = z.object({ label: z.string().trim().min(1).max(191), optionsText: z.string().max(3000), required: z.boolean(), showOnCheckin: z.boolean(), sensitive: z.boolean() }).safeParse({
    label: formData.get("label"), optionsText: formData.get("optionsText") ?? "", required: formData.get("required") === "on", showOnCheckin: formData.get("showOnCheckin") === "on", sensitive: formData.get("sensitive") === "on",
  });
  if (!parsed.success) redirect(`/organizer/${eventId}?error=invalid-field`);
  const updated = await db.$transaction(async (tx) => {
    const current = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true, fields: true, _count: { select: { registrants: true } } } });
    if (current.status !== "DRAFT" || current._count.registrants > 0) return false;
    const fields = readRegistrationFields(current.fields);
    const index = fields.findIndex((field) => field.key === fieldKey);
    if (index < 0) return false;
    const target = fields[index];
    const options = target.type === "select" || target.type === "checkbox"
      ? parsed.data.optionsText.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean)
      : undefined;
    if (options && (options.length < 2 || options.length > 30 || new Set(options).size !== options.length || options.some((value) => value.length > 191))) return false;
    const next = [...fields];
    next[index] = { ...target, label: parsed.data.label, required: parsed.data.required, showOnCheckin: parsed.data.showOnCheckin, sensitive: parsed.data.sensitive, options };
    if (!validateRegistrationFields(next)) return false;
    await tx.event.update({ where: { id: eventId }, data: { fields: next, fieldsVersion: { increment: 1 } } });
    if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "EVENT_FIELD_UPDATED_BY_ADMIN", target: fieldKey } });
    return true;
  });
  if (!updated) redirect(`/organizer/${eventId}?error=invalid-field`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field`);
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
  if (!moved) redirect(`/organizer/${eventId}?error=invalid-field`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field`);
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

  if (!moved) redirect(`/organizer/${eventId}?error=invalid-field`);
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=field`);
}
