import { timingSafeEqual } from "node:crypto";

import { expirePendingHolds } from "@/server/registrations/pending-holds";

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
  const result = await expirePendingHolds();
  return Response.json({ status: "ok", ...result }, { headers: { "Cache-Control": "no-store" } });
}
