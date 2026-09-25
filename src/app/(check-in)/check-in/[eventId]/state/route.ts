import { createHash } from "node:crypto";

import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * Lightweight poll target for check-in screens: an ETag over the session's check-ins (and registrant edits),
 * 304 when nothing changed, and otherwise only the check-in rows changed since `since` (ids and times, no personal data).
 */
export async function GET(request: Request, context: RouteContext<"/check-in/[eventId]/state">) {
  const { eventId } = await context.params;
  await requireEventAccess(eventId, "checkIn");
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("session") ?? "";
  const session = sessionId ? await db.session.findFirst({ where: { id: sessionId, eventId }, select: { id: true } }) : null;
  if (!session) return Response.json({ status: "not-found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

  const [active, latest, registrants] = await Promise.all([
    db.checkIn.count({ where: { sessionId, voidedAt: null } }),
    db.checkIn.aggregate({ where: { sessionId }, _max: { syncedAt: true, voidedAt: true }, _count: true }),
    db.registrant.aggregate({ where: { eventId }, _max: { updatedAt: true } }),
  ]);
  const version = [active, latest._count, latest._max.syncedAt?.getTime(), latest._max.voidedAt?.getTime(), registrants._max.updatedAt?.getTime()].join(":");
  const etag = `"${createHash("sha256").update(`${sessionId}:${version}`).digest("base64url").slice(0, 22)}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const sinceValue = Number(params.get("since"));
  const since = Number.isFinite(sinceValue) && sinceValue > 0 ? new Date(sinceValue) : null;
  const changes = since ? await db.checkIn.findMany({
    where: { sessionId, OR: [{ syncedAt: { gt: since } }, { checkedInAt: { gt: since } }, { voidedAt: { gt: since } }] },
    orderBy: { checkedInAt: "desc" }, take: 100,
    select: { id: true, registrantId: true, checkedInAt: true, voidedAt: true },
  }) : [];
  return Response.json({ status: "ok", activeCount: active, serverTime: Date.now(), changes }, { headers });
}
