import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * HTTP security headers — applied to every route via next.config.ts.
 * CSP is intentionally OMITTED here — it is set dynamically by
 * middleware (proxy.ts) with a per-request nonce so 'unsafe-inline'
 * can be removed from production script-src. All other headers are
 * static and sourced from security-headers.ts.
 */

const isDev = process.env.NODE_ENV !== "production";

/** Headers WITHOUT CSP — the static layer. CSP is added by middleware. */
function getStaticHeaders() {
  return [
    { key: "X-Frame-Options", value: isDev ? "ALLOWALL" : "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
  ];
}

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  compress: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "date-fns", "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-popover", "@radix-ui/react-select", "@radix-ui/react-tabs"],
  },
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [64, 128, 256, 384, 512],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    remotePatterns: [],
  },
  async headers() {
    return [
      // ─── Security headers for all routes ───────────────────────────
      { source: "/(.*)", headers: getStaticHeaders() },
      // ─── Static assets — immutable long-term cache ─────────────────
      {
        source: "/_next/static/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // ─── Uploaded avatars — immutable cache (filename includes hash) ──
      {
        source: "/uploads/avatars/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // ─── Public images — CDN cache ─────────────────────────────────
      {
        source: "/images/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      // ─── Public read-only API — short CDN cache ────────────────────
      {
        source: "/api/health",
        headers: [{ key: "Cache-Control", value: "public, s-maxage=30, stale-while-revalidate=120" }],
      },
      {
        source: "/api/fx/quote",
        headers: [{ key: "Cache-Control", value: "public, s-maxage=30, stale-while-revalidate=120" }],
      },
      {
        source: "/api/intl/rate",
        headers: [{ key: "Cache-Control", value: "public, s-maxage=30, stale-while-revalidate=120" }],
      },
      {
        source: "/api/testimonials",
        headers: [{ key: "Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=600" }],
      },
      // ─── Authenticated API — never cache ───────────────────────────
      {
        source: "/api/(.*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT ?? "javascript-nextjs",
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: false,
  },
});
