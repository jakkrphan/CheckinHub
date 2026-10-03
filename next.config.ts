import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded by Node at runtime instead of bundled, as in portalrpp (it opens raw TCP/TLS sockets).
  serverExternalPackages: ["ldapts"],
  // Dev only: lets other machines on the LAN open `next dev` by IP (comma-separated hostnames, no scheme or port).
  // Unset = localhost only. Has no effect on `next start`.
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",").map((host) => host.trim()).filter(Boolean),
  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
    // Enables forbidden() / forbidden.tsx for a real 403 on admin-only pages.
    authInterrupts: true,
  },
  async headers() {
    const production = process.env.NODE_ENV === "production";
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "form-action 'self'",
          "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com" + (production ? "" : " 'unsafe-eval'"),
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self' https://challenges.cloudflare.com",
          "frame-src https://challenges.cloudflare.com",
        ].join("; ") },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
      ],
    }];
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
