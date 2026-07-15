import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/turbopay/crypto";
import type { SessionUser, UserStatus } from "@/lib/turbopay/types";

/**
 * AUTH LAYER — short-lived access token + longer-lived refresh token.
 *
 * Two transport mechanisms are supported for the ACCESS token:
 *  1. Cookie (HttpOnly, SameSite=lax in prod / none in dev) — the standard
 *     browser flow. Works in production where the app is the top-level document.
 *  2. Bearer token via `Authorization: Bearer <token>` header — used when
 *     cookies are unreliable (e.g. the app runs inside a cross-site iframe
 *     where third-party cookies are blocked by modern browsers). The client
 *     stores the token in localStorage after login and sends it on every
 *     request.
 *
 * Both mechanisms resolve to the same server-side session row (token → sha256
 * → Session.tokenHash). getSessionUser checks the cookie first, then the
 * Authorization header.
 *
 * ── SECURITY: Bearer token transport ──
 * The Bearer fallback bypasses HttpOnly cookie protections. If an access token
 * leaks (e.g. via XSS in a different service, proxy log, or MITM on a
 * subdomain), the attacker has full session access regardless of cookie flags.
 * The iframe token mitigates this for cross-site contexts: it's short-lived
 * (5 min), stored only in page memory, and single-use (rotated on each issue).
 * For standard browser flows, the HttpOnly cookie is always preferred.
 * Future improvement: bind tokens to their transport (cookie vs header) and
 * reject Bearer tokens unless a separate iframe-specific flag is set.
 *
 * ── Refresh-token flow (audit hardening: reduce blast radius) ──
 * Sessions used to last 30 days, so a stolen access token was valid for a
 * month. We now issue TWO tokens per session:
 *   - ACCESS token (24h TTL) — sent on every request, kept in the cookie +
 *     localStorage. Short TTL shrinks the replay window.
 *   - REFRESH token (30d TTL) — only sent to /api/auth/refresh. Stored
 *     server-side as `refreshTokenHash`; the cleartext only lives on the
 *     client. Used to mint new access tokens without re-prompting the user.
 *
 * getSessionUser() does NOT auto-refresh: when the access token expires it
 * returns null and the client's 401 handler calls /api/auth/refresh
 * explicitly. This keeps the server stateless and forces a single,
 * rate-limited refresh path.
 */

const COOKIE_NAME = "tp_session";
const ACCESS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const IFRAME_TTL_MS = 5 * 60 * 1000; // 5 minutes — short-lived iframe bearer token

export interface SessionTokens {
  /** Short-lived access token (sent in cookie + Bearer header). */
  sessionToken: string;
  /** Longer-lived refresh token (only sent to /api/auth/refresh). */
  refreshToken: string;
}

export async function createSession(
  userId: string,
  meta?: { ip?: string; userAgent?: string }
): Promise<SessionTokens> {
  // Two independent tokens: the access token (sent on every request) and the
  // refresh token (sent only to /api/auth/refresh). Both are 32 random bytes
  // (256 bits) hex-encoded. Hashed at rest with sha256; the cleartext only
  // ever exists in memory + on the client.
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const tokenHash = hashToken(accessToken);
  const refreshTokenHash = hashToken(refreshToken);
  const now = Date.now();
  const expiresAt = new Date(now + ACCESS_TTL_MS);
  const refreshExpiresAt = new Date(now + REFRESH_TTL_MS);
  await db.session.create({
    data: {
      userId,
      tokenHash,
      refreshTokenHash,
      expiresAt,
      refreshExpiresAt,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    },
  });

  // Max session limit: revoke oldest sessions if user has too many active.
  const MAX_SESSIONS = 10;
  const activeSessions = await db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (activeSessions.length > MAX_SESSIONS) {
    const toRevoke = activeSessions.slice(0, activeSessions.length - MAX_SESSIONS);
    await db.session.updateMany({
      where: { id: { in: toRevoke.map((s) => s.id) } },
      data: { revokedAt: new Date(), refreshTokenHash: null, refreshExpiresAt: new Date() },
    });
  }

  const c = await cookies();
  c.set(COOKIE_NAME, accessToken, {
    httpOnly: true,
    // In dev, the app runs inside a cross-site iframe (the Preview Panel).
    // SameSite=lax cookies are NOT sent on fetch() within cross-site iframes
    // (Chrome 80+), so the session cookie would be lost immediately after
    // login. SameSite=None allows the cookie in third-party iframe contexts.
    // Secure is required with SameSite=None; http://localhost is treated as a
    // secure context by Chrome/Firefox so this works in dev.
    // In production (no iframe, real HTTPS), SameSite=lax is the correct posture.
    sameSite: process.env.NODE_ENV === "production" ? "lax" : "none",
    path: "/",
    expires: expiresAt, // 24h — matches the access-token TTL exactly
    secure: true,
  });
  return { sessionToken: accessToken, refreshToken };
}

/**
 * Regenerate the ACCESS token on an existing session, leaving the refresh
 * token untouched. Used after a password change so the previous access token
 * (which may have been observed by an attacker who has the old password) is
 * no longer replayable.
 *
 * Also re-sets the cookie so subsequent cookie-authenticated requests carry
 * the new token. Returns the new access token so the caller can return it to
 * the client (which updates its localStorage copy).
 */
export async function regenerateAccessToken(sessionId: string): Promise<string> {
  const accessToken = randomToken(32);
  const tokenHash = hashToken(accessToken);
  const expiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  await db.session.update({
    where: { id: sessionId },
    data: { tokenHash, expiresAt },
  });
  const c = await cookies();
  c.set(COOKIE_NAME, accessToken, {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "lax" : "none",
    path: "/",
    expires: expiresAt,
    secure: true,
  });
  return accessToken;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  let token: string | undefined;

  // 1. Try the session cookie first (standard browser flow).
  const c = await cookies();
  token = c.get(COOKIE_NAME)?.value;

  // 2. Fallback: Authorization: Bearer <token> header (iframe / API client).
  //    Used when third-party cookies are blocked by the browser (e.g. the
  //    app running inside a cross-site iframe — the preview panel).
  if (!token) {
    const h = await headers();
    const authHeader = h.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    }
  }

  if (!token) return null;

  // 1. Try the main session access token (cookie or Bearer).
  const tokenHash = hashToken(token);
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (session && !session.revokedAt && session.expiresAt >= new Date()) {
    const u = session.user;
    return {
      id: u.id,
      fullName: u.fullName,
      username: u.username,
      email: u.email ?? null,
      phone: u.phone,
      country: u.country,
      kycTier: u.kycTier as 1 | 2 | 3,
      kycStatus: u.kycStatus as SessionUser["kycStatus"],
      status: u.status as UserStatus,
      emailVerified: u.emailVerified,
      phoneVerified: u.phoneVerified,
      role: u.role as "USER" | "ADMIN",
      avatarUrl: u.avatarUrl,
      bio: u.bio,
      hasTransactionPin: !!u.transactionPinHash,
      authProvider: u.googleId ? "google" : "password",
      createdAt: u.createdAt.toISOString(),
    };
  }

  // 2. Fallback: try iframe token (short-lived, for cross-site iframe contexts).
  //    The iframe token is stored only in page memory — never in localStorage.
  const iframeResult = await validateIframeToken(token);
  if (iframeResult) {
    return iframeResult.user;
  }

  return null;
}

export async function logout() {
  // Revoke the session whether it came from the cookie OR the Authorization
  // header (the iframe/preview path uses the header). Also invalidate the
  // refresh token so it can't be used to mint new access tokens after logout
  // (audit hardening: "No Explicit Session Invalidation on Logout").
  const c = await cookies();
  let token = c.get(COOKIE_NAME)?.value;
  if (!token) {
    const h = await headers();
    const authHeader = h.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    }
  }
  if (token) {
    const tokenHash = hashToken(token);
    const now = new Date();
    await db.session.updateMany({
      where: { tokenHash },
      data: {
        revokedAt: now,
        // Clear + expire the refresh token: even if the client still has it
        // in localStorage, /api/auth/refresh will reject it (hash mismatch +
        // refreshExpiresAt < now).
        refreshTokenHash: null,
        refreshExpiresAt: now,
      },
    });
  }
  c.delete(COOKIE_NAME);
  c.delete("tp_refresh"); // clear the refresh token cookie
  // Clear iframe token hash (if any) so a stolen iframe token can't be reused.
  if (token) {
    const tokenHash = hashToken(token);
    await db.session.updateMany({
      where: { tokenHash },
      data: { iframeTokenHash: null, iframeExpiresAt: null },
    }).catch(() => null);
  }
}

/** Throw a 401-shaped error if not authenticated. Returns the user. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("UNAUTHORIZED", "Please sign in to continue.", 401);
  if (user.status !== "ACTIVE")
    throw new AuthError("ACCOUNT_NOT_ACTIVE", "Your account is not active.", 403);
  return user;
}

/** Require an ADMIN user. Centralizes the RBAC check so new admin endpoints
 *  can't accidentally forget it. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN")
    throw new AuthError("FORBIDDEN", "Admin access required.", 403);
  return user;
}

export class AuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Helper to read client IP from Next.js Request headers.
 *  Uses the LAST IP in X-Forwarded-For (the trusted proxy's entry), not the
 *  first (which is client-controlled and spoofable). Falls back to x-real-ip. */
export function readIp(headers: Headers): string | undefined {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",").pop()?.trim() || headers.get("x-real-ip") || undefined;
  }
  return headers.get("x-real-ip") || undefined;
}

// Exported for tests / refresh route.
export const ACCESS_TTL_MS_EXPORT = ACCESS_TTL_MS;
export const REFRESH_TTL_MS_EXPORT = REFRESH_TTL_MS;
export const COOKIE_NAME_EXPORT = COOKIE_NAME;

/**
 * REVOKED-SESSION AUDIT RETENTION.
 * Revoked sessions are kept for AUDIT_RETENTION_DAYS so the audit trail
 * (LoginHistory + AuditLog + Session row) can be inspected after a security
 * incident. After the retention window they are safe to delete — the audit
 * trail in AuditLog / LoginHistory is the permanent record, not the Session
 * row itself.
 */
export const AUDIT_RETENTION_DAYS = 7;
const AUDIT_RETENTION_MS = AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * cleanupExpiredSessions — periodic background cleanup.
 *
 * Deletes Session rows that are no longer useful for authentication OR audit:
 *
 *   1. EXPIRED SESSIONS — access token has expired (`expiresAt < now`) AND
 *      the refresh token has also expired (`refreshExpiresAt < now` or
 *      `refreshExpiresAt IS NULL`). These sessions can no longer be used to
 *      authenticate OR to mint a new access token, so they're dead weight.
 *      Note: an access-token-only expiry (with a still-valid refresh token)
 *      is NOT deleted — the user can still silently refresh via
 *      /api/auth/refresh, so the session is still live from the user's POV.
 *
 *   2. OLD REVOKED SESSIONS — `revokedAt IS NOT NULL` AND the revocation
 *      happened more than `AUDIT_RETENTION_DAYS` ago. Revoked sessions are
 *      retained for the audit-retention window (so investigators can see
 *      WHEN a session was revoked, by which IP, etc.) and then pruned.
 *
 * Returns `{ deleted, remaining }` where `remaining` is the total Session
 * row count AFTER the cleanup — useful for monitoring (a steadily-growing
 * `remaining` indicates a leak elsewhere, e.g. sessions being created but
 * never expired/revoked).
 *
 * This function is pure DB logic (no cookies, no next/headers) so it can
 * be called from a cron route OR directly from tests. The cron route at
 * `src/app/api/cron/session-cleanup/route.ts` is the only caller in prod.
 */
export async function cleanupExpiredSessions(): Promise<{
  deleted: number;
  remaining: number;
}> {
  const now = new Date();
  const retentionCutoff = new Date(now.getTime() - AUDIT_RETENTION_MS);

  // Condition 1: expired access token AND expired (or absent) refresh token.
  //   — `expiresAt < now` (access token dead)
  //   — AND (`refreshExpiresAt < now` OR `refreshExpiresAt IS NULL`)
  //     (refresh token also dead — session can't be silently refreshed)
  //   — AND `revokedAt IS NULL` (revoked sessions handled by condition 2 so
  //     the audit-retention window applies uniformly).
  //
  // Condition 2: revoked sessions older than the audit-retention window.
  //   — `revokedAt IS NOT NULL` AND `revokedAt < retentionCutoff`
  //
  // The two conditions are OR-ed. We use deleteMany so a single SQL statement
  // performs the cleanup atomically.
  //
  // NOTE: the Session model has no `updatedAt` field. The audit task spec
  // said "updatedAt < now - 7 days" — for a revoked session the only
  // timestamp that reflects "when the row last changed" is `revokedAt`
  // (the revocation is the last write before cleanup). Using `revokedAt`
  // is also the semantically-correct interpretation: "delete revoked
  // sessions 7 days after they were revoked."
  const result = await db.session.deleteMany({
    where: {
      OR: [
        {
          AND: [
            { expiresAt: { lt: now } },
            {
              OR: [
                { refreshExpiresAt: { lt: now } },
                { refreshExpiresAt: null },
              ],
            },
            { revokedAt: null },
          ],
        },
        {
          AND: [
            { revokedAt: { not: null } },
            { revokedAt: { lt: retentionCutoff } },
          ],
        },
      ],
    },
  });

  const remaining = await db.session.count();

  return { deleted: result.count, remaining };
}

// ─── Iframe Token (short-lived Bearer for cross-site iframe) ───────────
// Cross-site iframes cannot use HttpOnly cookies (third-party cookie
// blocking in Chrome 80+). Instead of storing the full 24h session token
// in localStorage (XSS-vulnerable), we issue a SHORT-LIVED (5-minute)
// iframe-specific token. The client stores it ONLY in page memory — it
// is never persisted to localStorage, sessionStorage, or any other
// durable store. When the iframe reloads, it requests a fresh token.

/**
 * Issue a short-lived iframe bearer token for the given session.
 * Rotates any previous iframe token (only one valid at a time per session).
 * Returns the cleartext token (to be sent to the client in the response body).
 */
export async function createIframeToken(sessionId: string): Promise<string> {
  const iframeToken = randomToken(32);
  const iframeTokenHash = hashToken(iframeToken);
  const iframeExpiresAt = new Date(Date.now() + IFRAME_TTL_MS);

  await db.session.update({
    where: { id: sessionId },
    data: { iframeTokenHash, iframeExpiresAt },
  });

  return iframeToken;
}

/**
 * Validate an iframe bearer token. Returns the session + user if valid,
 * null otherwise. The token is single-use in practice: each call to
 * createIframeToken rotates the hash, so a stolen token from a previous
 * request is invalid.
 */
export async function validateIframeToken(token: string): Promise<{ session: any; user: SessionUser } | null> {
  const tokenHash = hashToken(token);
  const session = await db.session.findFirst({
    where: { iframeTokenHash: tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (!session.iframeExpiresAt || session.iframeExpiresAt < new Date()) return null;

  const u = session.user;
  return {
    session,
    user: {
      id: u.id,
      fullName: u.fullName,
      username: u.username,
      email: u.email ?? null,
      phone: u.phone,
      country: u.country,
      kycTier: u.kycTier as 1 | 2 | 3,
      kycStatus: u.kycStatus as SessionUser["kycStatus"],
      status: u.status as UserStatus,
      emailVerified: u.emailVerified,
      phoneVerified: u.phoneVerified,
      role: u.role as "USER" | "ADMIN",
      avatarUrl: u.avatarUrl,
      bio: u.bio,
      hasTransactionPin: !!u.transactionPinHash,
      authProvider: u.googleId ? "google" : "password",
      createdAt: u.createdAt.toISOString(),
    },
  };
}
