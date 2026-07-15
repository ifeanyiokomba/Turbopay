import { db } from "@/lib/db";
import { requireUser, readIp, regenerateAccessToken } from "@/lib/turbopay/auth";
import { hashPassword, verifyPassword, hashToken } from "@/lib/turbopay/crypto";
import { isPasswordBreached } from "@/lib/turbopay/breach-check";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { cookies } from "next/headers";
import { z } from "zod";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8, "Password must be at least 8 characters") });

export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "change-password", limit: 5, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!dbUser || !dbUser.passwordHash || !verifyPassword(parsed.data.currentPassword, dbUser.passwordHash)) {
    return errorJson("Current password is incorrect", 400, "INVALID_PASSWORD");
  }

  // BREACH CHECK — HaveIBeenPwned k-anonymity. Same soft-fail policy as
  // registration: if the HIBP API is unreachable, proceed (don't block the
  // user from changing a password due to a transient third-party outage).
  try {
    const breached = await isPasswordBreached(parsed.data.newPassword);
    if (breached) {
      return errorJson(
        "This password has been found in known data breaches. Please choose a different password.",
        422,
        "BREACHED_PASSWORD",
      );
    }
  } catch {
    // Defensive: isPasswordBreached swallows errors internally and returns
    // false, but a double-catch ensures no uncaught throw blocks the change.
  }

  // Update password.
  await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(parsed.data.newPassword) } });

  // Session invalidation: preserve current session, revoke all others.
  // BUG FIX (P0): the canonical session cookie name is `tp_session` (see
  // src/lib/turbopay/auth.ts COOKIE_NAME). The previous code read
  // `turbopay_session` which is never set, so `currentTokenHash` was always
  // null and "preserve current session" actually revoked EVERY session —
  // logging the user out as a side-effect of changing their password.
  //
  // AUDIT HARDENING (auth-hardening-sessions): after revoking the OTHER
  // sessions, we ALSO rotate the CURRENT session's access token. Rationale:
  // an attacker who has the user's old password may also have observed the
  // current access token (e.g. via a leaked Authorization header in a proxy
  // log). Rotating the access token invalidates that leaked token immediately
  // while keeping the user signed in on this device. The refresh token is
  // left untouched (the user can still refresh). The new access token is
  // returned so the client can update its localStorage copy — otherwise the
  // client's next request would 401 (using the stale token) and trigger an
  // unnecessary refresh round-trip.
  const cookieStore = await cookies();
  const rawToken = cookieStore.get("tp_session")?.value ?? "";
  const currentTokenHash = rawToken ? hashToken(rawToken) : null;

  // Find the current session row (we need its id to rotate the access token).
  const currentSession = currentTokenHash
    ? await db.session.findUnique({ where: { tokenHash: currentTokenHash }, select: { id: true, revokedAt: true } })
    : null;

  // Revoke ALL other (non-current) sessions for this user.
  await db.session.updateMany({
    where: {
      userId: user.id,
      revokedAt: null,
      ...(currentTokenHash ? { NOT: { tokenHash: currentTokenHash } } : {}),
    },
    data: { revokedAt: new Date(), refreshTokenHash: null, refreshExpiresAt: new Date() },
  });

  // Rotate the current session's access token so the previous token (which
  // may have been observed by the attacker alongside the old password) can't
  // be replayed. regenerateAccessToken updates the DB row + the cookie.
  let newSessionToken: string | undefined;
  if (currentSession && !currentSession.revokedAt) {
    newSessionToken = await regenerateAccessToken(currentSession.id);
  }

  // Send security notification.
  try {
    const { notificationInbox } = await import("@/lib/turbocore/notifications-inbox");
    await notificationInbox.create({
      userId: user.id,
      type: "SECURITY",
      title: "Password changed",
      message: `Your TurboPay password was changed at ${new Date().toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos" })}. All other devices were signed out. If this wasn't you, please contact support immediately.`,
      priority: "HIGH",
    });
  } catch { /* notification must never block */ }

  await audit({
    userId: user.id,
    action: "PASSWORD_CHANGED",
    category: "AUTH",
    severity: "WARN",
    ip: readIp(req.headers),
    metadata: { sessionRotated: !!newSessionToken, otherSessionsRevoked: true },
  });

  // SECURITY: The rotated access token is set as an HttpOnly cookie by
  // regenerateAccessToken(). The client never sees the token value.
  return json({
    data: {
      ok: true,
    },
  });
}
