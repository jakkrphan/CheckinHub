import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { completeLineLogin } from "@/server/line/client";
import { lineAvailable, lineLinkFromState, linkLineAccount } from "@/server/line/link";
import { decodeLineLinkState, LINE_LINK_COOKIE } from "@/server/line/link-state";
import { db } from "@/server/db";
import { lineStatusToken } from "@/server/registrations/status-token";

export const dynamic = "force-dynamic";

/**
 * LINE Login comes back here after a registrant chooses LINE (registration form or status page). The LINE account is stored only when the
 * login is verified (signed state + nonce + ID token) and the person is a friend of the OA — pushes reach friends only.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = await cookies();
  // No cookie when LINE opened the callback in its in-app browser: fall back to the signed `state`.
  const link = decodeLineLinkState(store.get(LINE_LINK_COOKIE)?.value) ?? await lineLinkFromState(url.searchParams.get("state"));
  store.delete({ name: LINE_LINK_COOKIE, path: "/api/line" });
  const origin = (process.env.APP_BASE_URL ?? url.origin).replace(/\/$/, "");
  if (!link) {
    return new Response("<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>ลิงก์หมดอายุ</title><body style=\"font-family:sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.7\"><h1>ลิงก์เชื่อม LINE หมดอายุ</h1><p>กรุณากลับไปที่หน้าสถานะการลงทะเบียน แล้วกดเชื่อม LINE อีกครั้ง</p>", { status: 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  const back = (result: string) => NextResponse.redirect(`${origin}${link.returnPath}?line=${result}#line`, 303);
  if (url.searchParams.get("state") !== link.state) return back("error");
  // The person pressed cancel / did not allow on LINE's consent screen.
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code || !(await lineAvailable())) return back(code ? "unavailable" : "error");

  // Same redirect_uri as the authorize request (stored in the state cookie) — LINE rejects the exchange otherwise.
  const login = await completeLineLogin(code, link.redirectUri, link.nonce);
  if (!login.ok) {
    // Reason codes only (e.g. token-400), never tokens or LINE IDs — PDPA logging rule.
    console.warn(`LINE link failed: ${login.reason}`);
    return back("error");
  }
  if (!login.friend) return back("not-friend");
  const registrant = await db.registrant.findUnique({ where: { id: link.registrantId }, select: { status: true, anonymizedAt: true, event: { select: { deletedAt: true } } } });
  if (!registrant || registrant.anonymizedAt || registrant.event.deletedAt || registrant.status === "CANCELLED" || registrant.status === "REJECTED") return back("closed");
  const linked = await linkLineAccount(link.registrantId, login.userId);
  if (linked.result === "linked") return back("linked");
  // Proven owner of that LINE account: open the registration it already has (LINE-signed status link), not the cancelled copy.
  const slug = link.returnPath.split("/")[2];
  if (linked.original) return NextResponse.redirect(`${origin}/events/${slug}/status/${lineStatusToken(linked.original)}?line=duplicate#line`, 303);
  return back("duplicate");
}
