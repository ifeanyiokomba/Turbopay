import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validateOrigin } from "@/lib/turbopay/csrf";
import { buildCsp } from "@/lib/turbopay/security-headers";
import { generateNonce, CSP_NONCE_COOKIE } from "@/lib/turbopay/nonce";
import { generateCorrelationId, extractCorrelationId } from "@/lib/turbocore/correlation";

/**
 * PROXY — enforces session presence on protected routes + CSRF origin
 * validation on state-changing API requests.
 *
 * The proxy runs on the Edge Runtime and CANNOT use Prisma.
 * Full DB session validation happens inside each route via requireUser().
 * This is a fast first-line defense: if neither the session cookie NOR an
 * `Authorization: Bearer` header is present, reject immediately.
 *
 * Two auth mechanisms are supported (see src/lib/turbopay/auth.ts):
 *  1. `tp_session` cookie — standard browser flow (HttpOnly, 24h TTL).
 *  2. `Authorization: Bearer <token>` — short-lived (5-minute) iframe token
 *     for cross-site iframe contexts where third-party cookies are blocked.
 *     The token is stored only in page memory, never in localStorage.
 *
 * CSRF (defense-in-depth on top of the SameSite=lax session cookie):
 *  All POST/PUT/PATCH/DELETE requests to `/api/*` must carry a trusted
 *  `Origin` (or `Referer` fallback). Bearer-token requests are exempt from
 *  origin validation (an attacker cannot forge the Authorization header from
 *  a cross-origin form). Webhook routes are exempt — they use HMAC-SHA256
 *  signatures. Cron routes are exempt — they use the `x-cron-secret` header.
 */

const PROTECTED_API = [
  "/api/wallet", "/api/transfer", "/api/airtime", "/api/data",
  "/api/bills", "/api/kyc", "/api/profile", "/api/savings",
  "/api/investments", "/api/notifications", "/api/statements",
  "/api/virtual-cards", "/api/referrals", "/api/disputes",
  "/api/beneficiaries", "/api/scheduled-payments", "/api/rewards",
  "/api/vouchers", "/api/intl", "/api/support",
  "/api/payment-methods", "/api/payment-options", "/api/security",
];

/** HTTP methods that mutate server state — subject to CSRF origin checks. */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ─── Parsed once at module scope — avoids splitting env vars on every request ───
const BLOCKED_IPS = process.env.BLOCKED_IPS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
const ALLOWED_IPS = process.env.ALLOWED_IPS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

// ─── Lightweight in-memory rate limiter for Edge Runtime (admin routes only) ───
// This is a sliding-window counter per IP. It is intentionally simple: no Redis,
// no Prisma, just a Map that runs in the proxy's Edge isolate. For
// multi-instance production, the per-route rateLimit() in each handler (backed
// by Redis) is the authoritative defense; this proxy layer is a fast first
// line that blocks obvious abuse at the edge before it hits the app server.
const ADMIN_HITS = new Map<string, number[]>();
const ADMIN_WINDOW_MS = 60_000;
const ADMIN_MAX = 100;

function adminRateLimit(ip: string): NextResponse | null {
  const now = Date.now();
  const hits = ADMIN_HITS.get(ip);
  if (!hits) {
    ADMIN_HITS.set(ip, [now]);
    return null;
  }
  // Trim expired entries
  while (hits.length > 0 && hits[0] < now - ADMIN_WINDOW_MS) hits.shift();
  if (hits.length >= ADMIN_MAX) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  hits.push(now);
  return null;
}

/** Route prefixes that authenticate via signatures/secrets, NOT cookies. */
const CSRF_EXEMPT_PREFIXES = [
  "/api/webhooks/",            // legacy monnify route
  "/api/turbocore/webhooks/",  // generic registry route (ALL providers)
  "/api/intl/receive",         // intl receiving webhook alias
  "/api/cron/",                // cron jobs (x-cron-secret header)
];

/** Returns true if the request carries a session credential (cookie or bearer token). */
function hasSessionCredential(req: NextRequest): boolean {
  // 1. Session cookie.
  if (req.cookies.get("tp_session")?.value) return true;
  // 2. Authorization: Bearer <token> header.
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ") && authHeader.slice(7).trim().length > 0) return true;
  return false;
}

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isDev = process.env.NODE_ENV !== "production";
  const isApi = pathname.startsWith("/api/");

  // ─── Correlation ID ──────────────────────────────────────────────────
  // Generate or extract a correlation ID for every request. This ID
  // propagates through the full request lifecycle for end-to-end tracing.
  const correlationId = extractCorrelationId(req.headers) ?? generateCorrelationId();

  // ─── Fast-path: API routes don't need CSP headers ────────────────────
  // CSP only applies to document (HTML) responses. On JSON API responses
  // it's overhead with no security benefit. Skip nonce generation entirely.
  // Read the LAST IP in the X-Forwarded-For chain (the one added by the trusted
  // reverse proxy). Reading the first IP is vulnerable to spoofing: a client can
  // send `X-Forwarded-For: <attacker-ip>` and the first value would be the
  // attacker's spoofed IP, bypassing rate limiting, IP block/allow lists, and
  // audit trail accuracy.
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor
    ? forwardedFor.split(",").pop()?.trim() || req.headers.get("x-real-ip") || "unknown"
    : req.headers.get("x-real-ip") || "unknown";

  // ─── Maintenance mode ──────────────────────────────────────────────
  if (process.env.MAINTENANCE_MODE === "true") {
    if (
      !pathname.startsWith("/api/cron/") &&
      !pathname.startsWith("/api/health") &&
      !pathname.startsWith("/api/admin/")
    ) {
      return NextResponse.json(
        { error: "Service temporarily unavailable. We'll be back soon." },
        { status: 503, headers: { "Retry-After": "120" } },
      );
    }
  }

  // ─── IP block/allow list (parsed once at module scope) ─────────────
  if (BLOCKED_IPS.length > 0 && BLOCKED_IPS.includes(ip)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  const isAllowedIp = ALLOWED_IPS.length > 0 && ALLOWED_IPS.includes(ip);

  // ─── ALLOWED_IPS — trusted IPs skip rate limiting only ───────────────
  // Previously this skipped ALL checks (CSRF, auth, maintenance), which meant
  // IP spoofing via X-Forwarded-For could bypass the entire security stack.
  // Now ALLOWED_IPS only bypasses the admin rate limiter below; CSRF origin
  // validation, session credential checks, and maintenance mode still apply.

  // ─── CSRF: origin validation on state-changing API requests ───────────
  const hasBearerToken = !!(
    req.headers.get("authorization")?.startsWith("Bearer ") &&
    req.headers.get("authorization")!.slice(7).trim().length > 0
  );
  if (
    isApi &&
    STATE_CHANGING_METHODS.has(req.method.toUpperCase()) &&
    !CSRF_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p)) &&
    !hasBearerToken
  ) {
    if (!validateOrigin(req)) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(), level: "warn", msg: "csrf_rejected",
        method: req.method, path: pathname, ip,
      }));
      return NextResponse.json(
        { error: "Cross-origin request blocked" },
        { status: 403 }
      );
    }
  }

  // Structured access log for all admin routes.
  if (pathname.startsWith("/api/admin")) {
    // Exempt public admin auth routes (login, forgot-password, reset-password)
    const isPublicAdminRoute =
      pathname === "/api/admin/auth/login" ||
      pathname === "/api/admin/auth/forgot-password" ||
      pathname === "/api/admin/auth/reset-password" ||
      pathname === "/api/admin/auth/me";

    if (!isPublicAdminRoute) {
      // ALLOWED_IPS bypass: skip the edge rate limiter for trusted IPs.
      if (!isAllowedIp) {
        const rl = adminRateLimit(ip);
        if (rl) return rl;
      }
      console.log(JSON.stringify({
        ts: new Date().toISOString(), level: "info", msg: "admin_request",
        method: req.method, path: pathname, ip,
      }));
      if (!hasSessionCredential(req)) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
    }
    return NextResponse.next();
  }

  // Protected user API routes — must have a session cookie OR bearer token.
  if (PROTECTED_API.some((p) => pathname.startsWith(p))) {
    if (
      pathname === "/api/support/status" ||
      pathname === "/api/intl/receive" ||
      pathname.startsWith("/api/webhooks/") ||
      pathname.startsWith("/api/turbocore/webhooks/")
    ) {
      return NextResponse.next();
    }
    if (!hasSessionCredential(req)) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
  }

  // ─── CSP + nonce — only for HTML page responses ─────────────────────
  if (isApi) {
    // API routes: no CSP, no nonce cookie — pass through with correlation ID
    const response = NextResponse.next();
    response.headers.set("X-Correlation-ID", correlationId);
    return response;
  }

  const nonce = generateNonce();
  const response = NextResponse.next();
  response.headers.set("X-Correlation-ID", correlationId);
  const csp = buildCsp(nonce, isDev);
  response.headers.set("Content-Security-Policy", csp);
  response.cookies.set(CSP_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60,
    secure: !isDev,
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
