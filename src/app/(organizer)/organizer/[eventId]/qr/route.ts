import QRCode from "qrcode";

import { requireEventAccess } from "@/server/authorization/event";
import { publicEventUrl } from "@/server/events/public-url";

/** PNG of the public registration-link QR, for pasting into slides, posts or printed material. */
export async function GET(_request: Request, context: RouteContext<"/organizer/[eventId]/qr">) {
  const { eventId } = await context.params;
  const { event } = await requireEventAccess(eventId, "manage");
  const png = await QRCode.toBuffer(await publicEventUrl(event.slug), { width: 1024, margin: 2, errorCorrectionLevel: "H", type: "png" });
  return new Response(new Uint8Array(png), { headers: {
    "content-type": "image/png", "content-disposition": `attachment; filename="register-qr-${event.slug}.png"`, "cache-control": "private, no-store",
  } });
}
