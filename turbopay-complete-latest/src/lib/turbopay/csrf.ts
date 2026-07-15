/**
 * CSRF PROTECTION — Origin validation.
 * ====================================
 *
 * Defends against Cross-Site Request Forgery on state-changing API routes
 * (POST/PUT/PATCH/DELETE). The browser's same-site cookie model already blocks
 * most CSRF (the session cookie is `SameSite=lax` in production), but origin
 * validation is a defense-in-depth layer that also covers:
 *
 *   - Bearer-token clients that don't rely on cookies (the iframe/preview flow).
 *   - Legacy browsers that don't implement SameSite.
 *   - Any future regression in cookie attributes.
 *
 * Strategy: verify the `Origin` (or `Referer` fallback) header against an
 * allow-list of trusted origins. This is the OWASP-recommended approach for
 * modern apps — it avoids the double-submit-cookie complexity and works
 * without any client-side changes.
 *
 * Exemptions:
 *   - GET/HEAD/OPTIONS are safe (no state mutation) → always allowed.
 *   - Webhook routes use HMAC signatures (not cookies) → handled by the route.
 *   - Cron routes use the `x-cron-secret` header → handled by the route.
 *
 * Edge-runtime safe: no Node APIs, only the Web `Request`/`URL`/`Headers`
 * primitives (which are available on the Edge Runtime where middleware runs).
 */

/** HTTP methods that do not mutate server state — always allowed. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Always-on dev origin. The Next.js dev server runs on :3000. */
const DEV_ORIGIN = "http://localhost:3000";

/**
 * Build the set of origins we consider "same-origin" (trusted).
 *
 * Always includes `http://localhost:3000` (dev/preview). If
 * `NEXT_PUBLIC_APP_URL` is set, its origin is added — this is the production
 * app URL (e.g. `https://turbopay.example.com`). The env var is *parsed* so a
 * value like `https://turbopay.example.com/` (trailing slash) or
 * `https://turbopay.example.com:443` normalises to the bare origin
 * `https://turbopay.example.com`.
 *
 * Returns a Set for O(1) membership checks.
 */
export function getAllowedOrigins(): Set<string> {
  const origins = new Set<string>([DEV_ORIGIN]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).origin);
    } catch {
      // Malformed NEXT_PUBLIC_APP_URL — ignore. The operator should fix the
      // env var; in the meantime only the dev origin is trusted.
    }
  }
  return origins;
}

/**
 * Derive the request's own origin (scheme://host:port) from its URL.
 *
 * In a standard deployment this equals `NEXT_PUBLIC_APP_URL`'s origin. In the
 * sandbox dev environment the app is served behind the Caddy gateway on a
 * different port/host, so the request's own origin (as seen by the browser)
 * is the gateway origin — which is legitimately "same-origin" from the
 * browser's perspective and must be trusted for CSRF purposes.
 *
 * Returns `null` if the URL cannot be parsed (should not happen for real
 * inbound requests, but defensive).
 */
function getRequestOrigin(req: Request): string | null {
  try {
    return new URL(req.url).origin;
  } catch {
    return null;
  }
}

/** Normalise a raw Origin/Referer value to an origin string, or null if invalid. */
function normalizeOrigin(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Validate that a request originates from a trusted origin.
 *
 * Returns `true` for safe methods (GET/HEAD/OPTIONS) unconditionally.
 *
 * For state-changing methods (POST/PUT/PATCH/DELETE), the request is allowed
 * if the `Origin` header (or `Referer` fallback) matches ANY of:
 *   - the request's own origin (true same-origin — never CSRF by definition),
 *   - `http://localhost:3000` (dev/preview),
 *   - the origin of `NEXT_PUBLIC_APP_URL` (production app URL).
 *
 * If neither `Origin` nor `Referer` is present:
 *   - In development → allow (some browsers omit Origin for same-origin
 *     requests, and dev tooling often sends bare requests).
 *   - In production → reject (modern browsers always send Origin on
 *     cross-origin state changes; absence is suspicious).
 *
 * This function is pure and side-effect-free — safe to call from middleware
 * (Edge Runtime) or route handlers (Node Runtime).
 */
export function validateOrigin(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return true;

  // CSRF validation is enforced whenever NEXT_PUBLIC_APP_URL is set (known
  // deployment), regardless of NODE_ENV. This protects staging/UAT/preview
  // environments that are internet-accessible. Only skip when no app URL is
  // configured (pure localhost dev) — the dev-only security is provided by
  // rate limiting, password hashing, the session-cookie model, and bearer-token auth.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const isPublicDeployment = !!appUrl;
  if (!isPublicDeployment) return true;

  const allowed = getAllowedOrigins();
  // The request's own origin is always trusted — a same-origin request is
  // not CSRF by definition. This also covers the sandbox gateway where the
  // browser-visible origin differs from `localhost:3000`.
  const selfOrigin = getRequestOrigin(req);
  if (selfOrigin) allowed.add(selfOrigin);

  // 1. Origin header (preferred — present on all modern cross-origin + most
  //    same-origin state changes).
  const originHeader = req.headers.get("origin");
  if (originHeader) {
    const normalized = normalizeOrigin(originHeader);
    if (normalized && allowed.has(normalized)) return true;
    return false;
  }

  // 2. Referer fallback (older clients, some same-origin requests where the
  //    browser omits Origin but still sends Referer).
  const referer = req.headers.get("referer");
  if (referer) {
    const normalized = normalizeOrigin(referer);
    if (normalized && allowed.has(normalized)) return true;
    return false;
  }

  // 3. Neither header present.
  // Localhost dev (no NEXT_PUBLIC_APP_URL): allow (browsers/tools sometimes
  //   omit these headers locally).
  // Known deployment (NEXT_PUBLIC_APP_URL set): reject — a state-changing
  //   request with no Origin/Referer is characteristic of a forged request.
  return !isPublicDeployment;
}
