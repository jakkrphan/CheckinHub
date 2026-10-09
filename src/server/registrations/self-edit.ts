import { Prisma } from "@prisma/client";

import { checkRegistrationAnswers, readFileAnswers, readRegistrationFields, type AnswerProblem, type RegistrationFieldConfig, type RegistrationFileAnswer } from "@/features/events/registration-fields";
import { registrantDisplayName } from "@/features/registrations/display-name";
import { db } from "@/server/db";
import { deleteLocalRegistrationFiles } from "@/server/registrations/local-files";
import { statusTokenWhere } from "@/server/registrations/status-token";

export type SelfEditResult =
  | { status: "saved" | "unchanged" | "closed" | "not-found" }
  | { status: "invalid"; problem: AnswerProblem; formChanged: boolean };

/**
 * Validates an answer change against the full form (required fields, conditions, formats).
 * With `editable`, only those field keys are read from the submission and only they may change.
 * Answers under keys no longer in the form (fields the organizer removed) are carried over untouched.
 */
export function mergeAnswers(currentFields: RegistrationFieldConfig[], stored: unknown, formData: FormData, editable?: Set<string>) {
  const previous = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  // Check-in corrections must not fail because of fields staff cannot touch: a field added later as required,
  // or an option the organizer has since removed. Those keep their stored value as it is.
  const fields = editable ? currentFields.map((field) => {
    if (editable.has(field.key)) return field;
    const stale = ([] as unknown[]).concat(previous[field.key] ?? []).filter((value): value is string => typeof value === "string" && !!value && !!field.options && !field.options.includes(value));
    return { ...field, required: false, ...(stale.length ? { options: [...field.options!, ...new Set(stale)] } : {}) };
  }) : currentFields.map((field) => {
    // Registrants cannot upload on the self-edit page, so a file field added later cannot be required there.
    if (field.type === "file" && field.required && !readFileAnswers(previous[field.key]).length) return { ...field, required: false };
    return field;
  });
  const existingFiles: Record<string, RegistrationFileAnswer[]> = {};
  for (const field of fields) if (field.type === "file" && readFileAnswers(previous[field.key]).length) existingFiles[field.key] = readFileAnswers(previous[field.key]);
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
  const checked = checkRegistrationAnswers(fields, source, existingFiles, previous);
  if ("problem" in checked) return checked;
  const parsed = checked.answers;
  const known = new Set(fields.map((field) => field.key));
  const orphans = Object.fromEntries(Object.entries(previous).filter(([key]) => !known.has(key)));
  const answers = { ...orphans, ...parsed };
  const changed = [...new Set([...Object.keys(previous), ...Object.keys(answers)])]
    .filter((key) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(answers[key] ?? null));
  if (editable && changed.some((key) => !editable.has(key))) return { problem: { fieldKey: null, reason: "invalid" } as AnswerProblem };
  const kept = new Set(Object.values(answers).flatMap((value) => readFileAnswers(value)).map((file) => file.storageKey));
  const orphanedFiles = Object.values(existingFiles).flat().map((file) => file.storageKey).filter((key) => !kept.has(key));
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
    where: await statusTokenWhere(token),
    select: {
      id: true, eventId: true, status: true, anonymizedAt: true, answers: true,
      event: { select: { slug: true, status: true, registrationDeadline: true, deletedAt: true, fields: true, fieldsVersion: true } },
    },
  });
  if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt) return { status: "not-found" };
  if (!canSelfEdit(registrant, registrant.event)) return { status: "closed" };

  const merged = mergeAnswers(readRegistrationFields(registrant.event.fields), registrant.answers, formData);
  // The form version the page was rendered with tells a real mistake apart from "the organizer changed the form".
  if ("problem" in merged) return { status: "invalid", problem: merged.problem, formChanged: formData.get("fieldsVersion") !== String(registrant.event.fieldsVersion) };
  const { answers, changed, orphanedFiles } = merged;
  if (!changed.length) return { status: "unchanged" };

  await db.$transaction([
    // Recorded with the change, so an upload that drops out is removed by the orphan sweep even if the delete below fails.
    db.pendingFile.createMany({ data: orphanedFiles.map((key) => ({ key })), skipDuplicates: true }),
    db.registrant.update({ where: { id: registrant.id }, data: { answers: answers as Prisma.InputJsonValue, displayName: registrantDisplayName(readRegistrationFields(registrant.event.fields), answers), fieldsVersion: registrant.event.fieldsVersion } }),
    db.auditLog.create({ data: { eventId: registrant.eventId, actorId: null, action: "REGISTRANT_SELF_EDITED", target: registrant.id, metadata: { changedFields: changed } } }),
  ]);
  // A file answer can drop out when its condition no longer applies; remove the orphaned upload.
  await deleteLocalRegistrationFiles(orphanedFiles);
  return { status: "saved" };
}
