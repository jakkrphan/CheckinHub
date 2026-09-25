import { Prisma } from "@prisma/client";

import { parseRegistrationAnswers, readRegistrationFields, type RegistrationFieldConfig, type RegistrationFileAnswer } from "@/features/events/registration-fields";
import { db } from "@/server/db";
import { deleteLocalRegistrationFiles } from "@/server/registrations/local-files";
import { hashBearerCode } from "@/server/registrations/registration";

export type SelfEditResult = "saved" | "unchanged" | "invalid" | "closed" | "not-found";

const isFileAnswer = (value: unknown): value is RegistrationFileAnswer =>
  !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as { storageKey?: unknown }).storageKey === "string";

/**
 * Validates an answer change against the full form (required fields, conditions, formats).
 * With `editable`, only those field keys are read from the submission and only they may change.
 */
export function mergeAnswers(fields: RegistrationFieldConfig[], stored: unknown, formData: FormData, editable?: Set<string>) {
  const previous = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  const existingFiles: Record<string, RegistrationFileAnswer> = {};
  for (const field of fields) if (field.type === "file" && isFileAnswer(previous[field.key])) existingFiles[field.key] = previous[field.key] as RegistrationFileAnswer;
  let source = formData;
  if (editable) {
    source = new FormData();
    for (const field of fields) {
      if (field.type === "file") continue;
      const name = `answer:${field.key}`;
      const values = editable.has(field.key) ? formData.getAll(name) : ([] as unknown[]).concat(previous[field.key] ?? []);
      for (const value of values) if (typeof value === "string") source.append(name, value);
    }
  }
  const answers = parseRegistrationAnswers(fields, source, existingFiles);
  if (!answers) return null;
  const changed = [...new Set([...Object.keys(previous), ...Object.keys(answers)])]
    .filter((key) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(answers[key] ?? null));
  if (editable && changed.some((key) => !editable.has(key))) return null;
  const kept = new Set(Object.values(answers).filter(isFileAnswer).map((file) => file.storageKey));
  const orphanedFiles = Object.values(existingFiles).map((file) => file.storageKey).filter((key) => !kept.has(key));
  return { answers, changed, orphanedFiles };
}

/** Whether a registrant may still edit their own answers: open event, before the deadline, and not cancelled/rejected. */
export function canSelfEdit(registrant: { status: string; anonymizedAt: Date | null }, event: { status: string; registrationDeadline: Date | null; deletedAt: Date | null }, now = new Date()) {
  return !registrant.anonymizedAt && !["CANCELLED", "REJECTED"].includes(registrant.status)
    && !event.deletedAt && event.status === "PUBLISHED" && !!event.registrationDeadline && event.registrationDeadline > now;
}

/**
 * Registrants may correct their own answers before the deadline.
 * Email (the duplicate key) and uploaded files stay as they are; the audit lists changed field keys, never values.
 */
export async function updateOwnAnswers(slug: string, token: string, formData: FormData): Promise<SelfEditResult> {
  const registrant = await db.registrant.findUnique({
    where: { statusTokenHash: hashBearerCode(token) },
    select: {
      id: true, eventId: true, status: true, anonymizedAt: true, answers: true,
      event: { select: { slug: true, status: true, registrationDeadline: true, deletedAt: true, fields: true, fieldsVersion: true } },
    },
  });
  if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt) return "not-found";
  if (!canSelfEdit(registrant, registrant.event)) return "closed";

  const merged = mergeAnswers(readRegistrationFields(registrant.event.fields), registrant.answers, formData);
  if (!merged) return "invalid";
  const { answers, changed, orphanedFiles } = merged;
  if (!changed.length) return "unchanged";

  await db.$transaction([
    db.registrant.update({ where: { id: registrant.id }, data: { answers: answers as Prisma.InputJsonValue, fieldsVersion: registrant.event.fieldsVersion } }),
    db.auditLog.create({ data: { eventId: registrant.eventId, actorId: null, action: "REGISTRANT_SELF_EDITED", target: registrant.id, metadata: { changedFields: changed } } }),
  ]);
  // A file answer can drop out when its condition no longer applies; remove the orphaned upload.
  await deleteLocalRegistrationFiles(orphanedFiles);
  return "saved";
}
