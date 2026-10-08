import { timingSafeEqual } from "node:crypto";

import { anonymizeExpiredEvents, sweepOrphanFiles } from "@/server/registrations/retention";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ status: "unavailable" }, { status: 503 });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }
  const result = await anonymizeExpiredEvents();
  // After anonymizing, so this pass also catches files whose deletion failed there. A failed sweep is reported on its
  // own (null) instead of hiding the anonymization that already happened; the next run tries again.
  const sweep = await sweepOrphanFiles().catch((error: unknown) => {
    console.error(`Orphan file sweep failed: ${(error as Error).name}`);
    return null;
  });
  // "folder-shared": UPLOAD_DIR is also used by another database, so nothing was deleted — give each system its own folder.
  if (sweep === "folder-shared") console.error("Orphan file sweep skipped: UPLOAD_DIR belongs to another database");
  const orphans = typeof sweep === "number" ? { orphanFilesDeleted: sweep } : { orphanFilesDeleted: null, orphanSweepSkipped: sweep ?? "error" };
  return Response.json({ status: "ok", ...result, ...orphans }, { headers: { "Cache-Control": "no-store" } });
}
