/**
 * SECURITY HEADERS — single source of truth.
 * ==========================================
 *
 * The HTTP security headers applied to every route are defined HERE (not
 * inline in `next.config.ts`) so that:
 *
 *   1. `next.config.ts` applies them at build/runtime via `headers()`.
 *   2. The `/api/admin/security/headers` audit route can return the EXACT
 *      configuration admins need to verify — without duplicating the strings
 *      (which inevitably drift).
 *
 * The Content-Security-Policy is the most important header. It is split into
 * a production policy and a development policy:
 *
 *   - PRODUCTION: drops `'unsafe-eval'` (Turbopack needs it only in dev), keeps
 *     `'unsafe-inline'` for script-src (Next.js injects inline runtime chunks;
 *     removing it requires per-request nonces which Next.js 16 does not yet
 *     expose cleanly), and adds `base-uri`, `form-action`, `object-src`, and
 *     `frame-ancestors` hardenings.
 *   - DEVELOPMENT: keeps `'unsafe-eval'` (Turbopack HMR/eval) and relaxes
 *     `frame-ancestors` to `*` so the Preview Panel iframe can render the app.
 */

/**
 * Build a nonce-scoped Content-Security-Policy string.
 *
 * In production, `'unsafe-inline'` is replaced by `'nonce-<value>'` so
 * inline scripts are only allowed when they carry the matching nonce.
 * This eliminates the XSS risk of `'unsafe-inline'` while keeping
 * Next.js runtime chunks functional (they are injected with the nonce
 * set on the `<html>` element).
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  if (isDev) {
    // Dev: keep 'unsafe-eval' (Turbopack HMR) + 'unsafe-inline' for simplicity.
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
      "font-src 'self' fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors *",
    ].join("; ");
  }
  // Production: nonce replaces 'unsafe-inline' in script-src.
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
    "font-src 'self' fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://*.ingest.us.sentry.io https://*.ingest.sentry.io",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** Production Content-Security-Policy (fallback when nonce is unavailable). */
export const PRODUCTION_CSP =
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
    "font-src 'self' fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://*.ingest.us.sentry.io https://*.ingest.sentry.io",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

/** Always-on dev origin. Mirrors `DEV_ORIGIN` in `csrf.ts`. */
const DEV_ORIGIN = "http://localhost:3000";

/** Development Content-Security-Policy (keeps 'unsafe-eval' for Turbopack). */
export const DEV_CSP =
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
    "font-src 'self' fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://*.ingest.us.sentry.io https://*.ingest.sentry.io",
    "frame-ancestors *",
  ].join("; ");

export interface SecurityHeaderEntry {
  key: string;
  value: string;
}

/**
 * Return the active security headers for the given environment.
 * `isDev` should be `process.env.NODE_ENV !== "production"`.
 *
 * When `nonce` is provided (production), the CSP includes the nonce and
 * `'unsafe-inline'` is removed from `script-src`. When omitted, a
 * fallback CSP with `'unsafe-inline'` is used (for the static config
 * headers set by `next.config.ts` before middleware runs).
 *
 * Mirrors the previous inline definition in `next.config.ts`, with the CSP
 * strings sourced from this module.
 */
export function getSecurityHeaders(isDev: boolean, nonce?: string): SecurityHeaderEntry[] {
  const csp = nonce ? buildCsp(nonce, isDev) : (isDev ? DEV_CSP : PRODUCTION_CSP);
  return [
    // DENY in production; ALLOWALL in dev so the preview iframe can render.
    { key: "X-Frame-Options", value: isDev ? "ALLOWALL" : "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ...(isDev
      ? []
      : [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]),
    { key: "Content-Security-Policy", value: csp },
  ];
}

/** Parse a CSP string into an ordered map of directive → source list. */
function parseCsp(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(" ");
    const name = space === -1 ? trimmed : trimmed.slice(0, space);
    const rest = space === -1 ? "" : trimmed.slice(space + 1);
    out[name] = rest ? rest.split(/\s+/) : [];
  }
  return out;
}

export interface CspAuditEntry {
  directive: string;
  sources: string[];
  /** Why this directive/source is present (human-readable). */
  rationale: string;
}

export interface SecurityHeadersAudit {
  /** Current environment the audit was taken in. */
  environment: "production" | "development";
  /** The headers actually being applied in this environment. */
  activeHeaders: SecurityHeaderEntry[];
  csp: {
    /** The active CSP string for the current environment. */
    active: string;
    /** The production CSP (for cross-env comparison). */
    production: string;
    /** The development CSP. */
    development: string;
    /** Parsed directives of the active CSP. */
    directives: Record<string, string[]>;
  };
  /** Explanation of each CSP directive for admin review. */
  cspDirectiveRationale: CspAuditEntry[];
  /** CSRF protection status (origin-validation layer in middleware). */
  csrf: {
    enabled: true;
    mechanism: "origin-validation";
    safeMethods: ["GET", "HEAD", "OPTIONS"];
    stateChangingMethods: ["POST", "PUT", "PATCH", "DELETE"];
    exemptRoutes: string[];
    allowedOrigins: string[];
    missingOriginPolicy: {
      development: "allow";
      production: "reject";
    };
  };
  /** Operator notes surfaced in the admin UI. */
  notes: string[];
}

/**
 * Build the full audit payload. Used by `/api/admin/security/headers` so
 * admins can verify the headers are correct in production without needing
 * shell access to inspect `next.config.ts`.
 */
export function getSecurityHeadersAudit(): SecurityHeadersAudit {
  const isDev = process.env.NODE_ENV !== "production";
  const activeCsp = isDev ? DEV_CSP : PRODUCTION_CSP;

  // Allowed origins for CSRF — re-derived here (NOT imported from csrf.ts) so
  // the audit module has zero runtime dependencies and can be loaded safely
  // in any context. The logic mirrors getAllowedOrigins() exactly.
  const csrfAllowed = [DEV_ORIGIN];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      const origin = new URL(appUrl).origin;
      if (!csrfAllowed.includes(origin)) csrfAllowed.push(origin);
    } catch {
      // ignore malformed
    }
  }

  return {
    environment: isDev ? "development" : "production",
    activeHeaders: getSecurityHeaders(isDev),
    csp: {
      active: activeCsp,
      production: PRODUCTION_CSP,
      development: DEV_CSP,
      directives: parseCsp(activeCsp),
    },
    cspDirectiveRationale: [
      { directive: "default-src", sources: ["'self'"], rationale: "Deny-by-default — only same-origin resources load unless a more specific directive allows them." },
      { directive: "script-src", sources: parseCsp(activeCsp)["script-src"] ?? [], rationale: isDev ? "'unsafe-eval' kept for Turbopack HMR/devtooling; 'unsafe-inline' for Next.js runtime chunks." : "'unsafe-eval' removed in production (Turbopack doesn't need it); 'unsafe-inline' kept for Next.js inline runtime (requires nonces to remove)." },
      { directive: "style-src", sources: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"], rationale: "Inline styles for Next.js CSS runtime + Google Fonts stylesheet host." },
      { directive: "font-src", sources: ["'self'", "fonts.gstatic.com"], rationale: "Same-origin + Google Fonts file host." },
      { directive: "img-src", sources: ["'self'", "data:", "blob:"], rationale: "Allow data: URIs (avatars/inline images) and blob: (client-side image processing)." },
      { directive: "connect-src", sources: ["'self'"], rationale: "XHR/fetch/WebSocket only to same origin. No third-party API calls from the browser." },
      { directive: "frame-ancestors", sources: isDev ? ["*"] : ["'self'"], rationale: isDev ? "Dev: relaxed so the Preview Panel iframe can render." : "Production: clickjacking defense — only same-origin may embed." },
      { directive: "base-uri", sources: ["'self'"], rationale: "Prevents <base> tag injection from redirecting relative URLs to an attacker origin." },
      { directive: "form-action", sources: ["'self'"], rationale: "Prevents forms from submitting to external origins (CSRF/data exfiltration defense)." },
      { directive: "object-src", sources: ["'none'"], rationale: "Blocks Flash/Java/plugin embedding — legacy plugin vectors." },
    ],
    csrf: {
      enabled: true,
      mechanism: "origin-validation",
      safeMethods: ["GET", "HEAD", "OPTIONS"],
      stateChangingMethods: ["POST", "PUT", "PATCH", "DELETE"],
      exemptRoutes: ["/api/webhooks/*", "/api/cron/*"],
      allowedOrigins: csrfAllowed,
      missingOriginPolicy: {
        development: "allow",
        production: "reject",
      },
    },
    notes: [
      isDev
        ? "Development mode: CSP keeps 'unsafe-eval' (Turbopack) and frame-ancestors is relaxed for the Preview Panel."
        : "Production mode: 'unsafe-eval' removed from script-src; frame-ancestors locked to 'self'.",
      "CSRF is enforced in middleware via Origin/Referer validation on all state-changing /api/* routes except webhooks (HMAC) and cron (CRON_SECRET).",
      process.env.NEXT_PUBLIC_APP_URL
        ? `NEXT_PUBLIC_APP_URL is set → its origin is in the CSRF allow-list.`
        : "WARNING: NEXT_PUBLIC_APP_URL is not set — only http://localhost:3000 is in the CSRF allow-list. Set it in production or browser POST requests will be rejected.",
      "'unsafe-inline' remains in script-src because Next.js 16 injects inline runtime chunks; removing it requires per-request nonces which are not yet wired.",
    ],
  };
}
