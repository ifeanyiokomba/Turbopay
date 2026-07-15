import { db } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/turbopay/crypto";
import { readIp } from "@/lib/turbopay/auth";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { cookies } from "next/headers";

/**
 * POST /api/auth/refresh
 *
 * Mints a NEW short-lived access token using a valid refresh token.
 *
 * SECURITY: The refresh token is read from an HttpOnly cookie
 * (`tp_refresh`), NOT from the request body. This eliminates the
 * XSS-vulnerable pattern of storing refresh tokens in localStorage.
 * The new tokens are set as HttpOnly cookies — the response body
 * contains only a success flag, never the token values.
 *
 * Flow:
 *   1. Client's access token expires (24h) → API call returns 401.
 *   2. client.ts apiFetch calls this endpoint (cookies sent automatically).
 *   3. We read the refresh token from the tp_refresh cookie, validate it,
 *      and rotate both tokens (new cookies set via Set-Cookie headers).
 *   4. On failure we revoke the session (suspected stolen refresh token).
 *
 * Rate-limited: 10/hour per IP.
 */

const ACCESS_TTL_MS = 24 * 60 * 60 * 1000; // 24h — must match auth.ts

export async function POST(req: Request) {
  const limited = await rateLimit(req, {
    key: "refresh",
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (limited) return limited;

  // Read the refresh token from the HttpOnly cookie.
  const c = await cookies();
  const refreshToken = c.get("tp_refresh")?.value;

  if (!refreshToken) {
    return errorJson("No refresh token. Please sign in again.", 401, "NO_REFRESH_TOKEN");
  }

  const refreshTokenHash = hashToken(refreshToken);
  const now = new Date();

  const session = await db.session.findFirst({
    where: { refreshTokenHash },
    include: { user: true },
  });

  // No session found with this refresh token hash.
  if (!session) {
    // REUSE DETECTION: check if a session exists with a DIFFERENT refresh
    // token — the presented token was rotated away, signaling potential theft.
    const staleSession = await db.session.findFirst({
      where: { refreshTokenHash: { not: null } },
      include: { user: true },
      orderBy: { createdAt: "desc" },
    });
    if (staleSession && staleSession.refreshTokenHash !== refreshTokenHash) {
      await db.session.update({
        where: { id: staleSession.id },
        data: { revokedAt: new Date(), refreshTokenHash: null, refreshExpiresAt: new Date() },
      }).catch(() => null);
      await audit({
        userId: staleSession.userId,
        action: "REFRESH_TOKEN_REUSE_DETECTED",
        category: "AUTH",
        severity: "CRITICAL",
        ip: readIp(req.headers),
        metadata: { sessionId: staleSession.id },
      }).catch(() => null);
    }
    return errorJson("Invalid or expired refresh token", 401, "INVALID_REFRESH_TOKEN");
  }

  if (session.revokedAt) {
    return errorJson("Session revoked", 401, "INVALID_REFRESH_TOKEN");
  }

  if (!session.refreshExpiresAt || session.refreshExpiresAt < now) {
    await db.session.update({
      where: { id: session.id },
      data: { revokedAt: now },
    }).catch(() => null);
    return errorJson("Refresh token expired. Please sign in again.", 401, "INVALID_REFRESH_TOKEN");
  }

  // Rotate both tokens (access + refresh). New refresh token invalidates old.
  const newAccessToken = randomToken(32);
  const newRefreshToken = randomToken(32);
  const newTokenHash = hashToken(newAccessToken);
  const newRefreshTokenHash = hashToken(newRefreshToken);
  const newExpiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  const newRefreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30d

  await db.session.update({
    where: { id: session.id },
    data: {
      tokenHash: newTokenHash,
      expiresAt: newExpiresAt,
      refreshTokenHash: newRefreshTokenHash,
      refreshExpiresAt: newRefreshExpiresAt,
    },
  });

  // Set both new tokens as HttpOnly cookies. The response body contains
  // NO token values — the client never sees them.
  c.set("tp_session", newAccessToken, {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "lax" : "none",
    path: "/",
    expires: newExpiresAt,
    secure: true,
  });
  c.set("tp_refresh", newRefreshToken, {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "lax" : "none",
    path: "/api/auth/refresh",
    expires: newRefreshExpiresAt,
    secure: true,
  });

  try {
    await audit({
      userId: session.userId,
      action: "SESSION_REFRESHED",
      category: "AUTH",
      severity: "INFO",
      ip: readIp(req.headers),
      metadata: { sessionId: session.id },
    });
  } catch { /* non-blocking */ }

  // No tokens in response body — they're in HttpOnly cookies only.
  return json({ data: { ok: true } });
}
