import { timingSafeEqual } from "node:crypto";

import { processLineNotifications } from "@/server/line/notifications";
import { processEmailNotifications } from "@/server/email/notifications";

export const dynamic = "force-dynamic";

/** Retries due notifications. LINE runs first so this pass also picks up new email fallbacks. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ status: "unavailable" }, { status: 503 });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }
  const line = await processLineNotifications(25);
  const email = await processEmailNotifications(25);
  const totals = { sent: line.sent + email.sent, failed: line.failed + email.failed, retry: line.retry + email.retry, skipped: line.skipped + email.skipped };
  return Response.json({ status: "ok", ...totals, line, email }, { headers: { "Cache-Control": "no-store" } });
}
