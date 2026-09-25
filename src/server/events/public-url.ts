import { headers } from "next/headers";
import QRCode from "qrcode";

/** Absolute public registration URL, preferring APP_BASE_URL over the request host. */
export async function publicEventUrl(slug: string) {
  const requestHeaders = await headers();
  const origin = process.env.APP_BASE_URL ?? `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`;
  return `${origin}/events/${slug}`;
}

/** Scalable QR for the registration link; high error correction so printed copies survive smudges and folds. */
export const registrationQrSvg = (url: string) => QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "H", color: { dark: "#000000", light: "#ffffff" } });
