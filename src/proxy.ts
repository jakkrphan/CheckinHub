import { NextResponse, type NextRequest } from "next/server";

/** Passes the requested staff-area path to server components so an expired session can return here after login. */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-return-to", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/organizer/:path*", "/admin/:path*", "/check-in/:path*", "/account/password"],
};
