import { notFound } from "next/navigation";
import QRCode from "qrcode";

import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";

export async function GET(_request: Request, context: RouteContext<"/organizer/[eventId]/registrants/[registrantId]/qr">) {
  const { eventId, registrantId } = await context.params;
  await requireEventAccess(eventId, "manage");
  const person = await db.registrant.findFirst({ where: { id: registrantId, eventId, status: "APPROVED" }, select: { qrCode: true } });
  if (!person?.qrCode) notFound();
  const png = await QRCode.toBuffer(person.qrCode, { width: 512, margin: 2, type: "png" });
  return new Response(new Uint8Array(png), { headers: {
    "content-type": "image/png", "content-disposition": `attachment; filename="checkin-${registrantId}.png"`, "cache-control": "private, no-store",
  } });
}
