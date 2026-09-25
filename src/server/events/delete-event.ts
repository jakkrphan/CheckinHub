import { db } from "@/server/db";
import { deleteLocalCover } from "@/server/registrations/local-covers";

export async function deleteEventPreservingHistory(eventId: string, actorId: string) {
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { id: true, slug: true, coverImageKey: true, deletedAt: true, _count: { select: { registrants: true } } } });
    if (!event || event.deletedAt) return null;
    const retained = event._count.registrants > 0;
    if (retained) await tx.event.update({ where: { id: eventId }, data: { deletedAt: new Date(), status: "CLOSED" } });
    else await tx.event.delete({ where: { id: eventId } });
    await tx.auditLog.create({ data: { eventId: retained ? eventId : null, actorId, action: retained ? "EVENT_SOFT_DELETED" : "EVENT_DELETED", target: eventId, metadata: { retainedRegistrants: event._count.registrants } } });
    return { slug: event.slug, coverImageKey: retained ? null : event.coverImageKey, retained };
  });
  if (result && !result.retained) await deleteLocalCover(result.coverImageKey);
  return result;
}
