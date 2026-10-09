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
  // After anonymizing, so files whose deletion failed there (recorded in PendingFile) are retried once a day old.
  // A failed sweep is reported on its own (orphanFilesDeleted: null) instead of hiding the anonymization that already
  // happened; the next run tries again.
  const orphanFilesDeleted = await sweepOrphanFiles().catch((error: unknown) => {
    console.error(`Orphan file sweep failed: ${(error as Error).name}`);
    return null;
  });
  return Response.json({ status: "ok", ...result, orphanFilesDeleted }, { headers: { "Cache-Control": "no-store" } });
}
