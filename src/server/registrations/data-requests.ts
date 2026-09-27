import { Prisma } from "@prisma/client";

import { db } from "@/server/db";
import { syncRegistrantStatus } from "@/server/registrations/day-status";
import { lockEventDays, promoteWaitlist } from "@/server/registrations/lifecycle";
import { deleteLocalRegistrationFiles } from "@/server/registrations/local-files";
import { hashBearerCode } from "@/server/registrations/registration";
import { anonymizedRegistrantData, fileKeys } from "@/server/registrations/retention";

const REASON_MAX = 500;

/**
 * PDPA "delete my data" request from the status page. One open request per registrant; the audit entry carries
 * no personal data (the registrant's reason stays on the request only until it is resolved).
 */
export async function requestOwnDeletion(slug: string, token: string, rawReason: FormDataEntryValue | null) {
  const registrant = await db.registrant.findUnique({
    where: { statusTokenHash: hashBearerCode(token) },
    select: { id: true, eventId: true, anonymizedAt: true, event: { select: { slug: true, deletedAt: true } }, dataRequests: { where: { status: "OPEN" }, select: { id: true } } },
  });
  if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt || registrant.anonymizedAt) return "not-found" as const;
  if (registrant.dataRequests.length) return "exists" as const;
  const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim().slice(0, REASON_MAX) : null;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Registrant WHERE id = ${registrant.id} FOR UPDATE`;
    if (await tx.dataRequest.count({ where: { registrantId: registrant.id, status: "OPEN" } })) return;
    const request = await tx.dataRequest.create({ data: { eventId: registrant.eventId, registrantId: registrant.id, reason } });
    await tx.auditLog.create({ data: { eventId: registrant.eventId, actorId: null, action: "DATA_DELETION_REQUESTED", target: registrant.id, metadata: { requestId: request.id } } });
  });
  return "created" as const;
}

/**
 * Carries out a deletion request: cancels whatever is still active (freeing seats for the queue), then anonymizes
 * the registrant exactly like the retention job and deletes their uploads. Check-in records stay, unnamed, for
 * statistics. The status link stops working afterwards.
 */
export async function completeDeletionRequest(eventId: string, requestId: string, actorId: string) {
  const outcome = await db.$transaction(async (tx) => {
    await lockEventDays(tx, eventId);
    const request = await tx.dataRequest.findFirst({ where: { id: requestId, eventId, status: "OPEN" }, select: { id: true, registrantId: true } });
    if (!request) return null;
    await tx.$queryRaw`SELECT id FROM Registrant WHERE id = ${request.registrantId} FOR UPDATE`;
    const person = await tx.registrant.findUniqueOrThrow({ where: { id: request.registrantId }, select: { answers: true } });
    const cancelled = await tx.registrantEventDay.updateMany({ where: { registrantId: request.registrantId, status: { in: ["PENDING", "APPROVED", "WAITLISTED"] } }, data: { status: "CANCELLED", waitlistedAt: null, pendingSince: null } });
    if (cancelled.count) {
      await syncRegistrantStatus(tx, request.registrantId);
      await promoteWaitlist(tx, eventId);
    }
    const now = new Date();
    await tx.registrant.update({ where: { id: request.registrantId }, data: anonymizedRegistrantData(now) });
    await tx.dataRequest.update({ where: { id: request.id }, data: { status: "COMPLETED", reason: null, resolvedAt: now, resolvedById: actorId } });
    await tx.auditLog.create({ data: { eventId, actorId, action: "DATA_DELETION_COMPLETED", target: request.registrantId, metadata: { requestId: request.id, cancelledDays: cancelled.count } } });
    return { files: fileKeys(person.answers) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  if (!outcome) return "missing" as const;
  await deleteLocalRegistrationFiles(outcome.files);
  return "completed" as const;
}

/** Declines a deletion request with a reason the registrant sees on their status page (e.g. a legal duty to keep records). */
export async function rejectDeletionRequest(eventId: string, requestId: string, actorId: string, rawNote: FormDataEntryValue | null) {
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, REASON_MAX) : "";
  if (note.length < 3) return "note" as const;
  const updated = await db.$transaction(async (tx) => {
    const request = await tx.dataRequest.findFirst({ where: { id: requestId, eventId, status: "OPEN" }, select: { id: true, registrantId: true } });
    if (!request) return false;
    await tx.dataRequest.update({ where: { id: request.id }, data: { status: "REJECTED", resolvedAt: new Date(), resolvedById: actorId, resolutionNote: note } });
    await tx.auditLog.create({ data: { eventId, actorId, action: "DATA_DELETION_REJECTED", target: request.registrantId, metadata: { requestId: request.id } } });
    return true;
  });
  return updated ? "rejected" as const : "missing" as const;
}
