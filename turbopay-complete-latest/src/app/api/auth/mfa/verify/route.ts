import { db } from "@/lib/db";
import { createSession, readIp } from "@/lib/turbopay/auth";
import { verifyToken, verifyBackupCode } from "@/lib/turbopay/mfa";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { extractDeviceInfo } from "@/lib/turbopay/device-info";
import { z } from "zod";
import { cookies } from "next/headers";

/**
 * MFA verification — the second step of the login flow when MFA is enabled.
 *
 * Flow:
 *   1. Client POSTs /api/auth/login with identifier + password.
 *   2. Server verifies the password; if MFA is enabled it returns
 *      `{ mfaRequired: true, userId }` INSTEAD of creating a session.
 *   3. Client shows the MFA input. User enters a 6-digit TOTP code (or a
 *      backup code).
 *   4. Client POSTs /api/auth/mfa/verify with `{ userId, token }` (or
 *      `{ userId, backupCode }`).
 *   5. THIS route verifies the code against the user's stored TOTP secret
 *      (or backup-code list) and on success creates the session + returns
 *      `sessionToken` + `refreshToken` + the user object — the same shape
 *      as /api/auth/login's success response. The client stores the tokens
 *      + sets the user, completing login.
 *
 * ── Security ──
 * The route is PUBLIC (no session yet — the user is mid-login). To prevent
 * code brute-force we apply TWO rate limits:
 *   - per-IP:           10/min   (catches a single attacker hammering many users)
 *   - per-userId:        5/15min (catches distributed-IP brute-force on a
 *                                 single account — 5 attempts vs. a 6-digit
 *                                 space of 10^6 is ~5×10⁻⁶ P(success))
 *
 * We also enforce the same gates as the login route: the user must be
 * ACTIVE + email-verified, else the verify call fails (defends against MFA
 * on a suspended/unverified account being used as an oracle).
 */

const schema = z.object({
  userId: z.string().min(1, "Missing user id"),
  token: z.string().regex(/^\d{6}$/, "Enter a 6-digit code").optional(),
  backupCode: z.string().min(1, "Enter a backup code").optional(),
}).refine((d) => !!d.token || !!d.backupCode, {
  message: "Provide either a 6-digit token or a backup code",
});

export async function POST(req: Request) {
  // Layer 1: per-IP rate limit.
  const ipLimited = await rateLimit(req, { key: "mfa-verify", limit: 10, windowMs: 60_000 });
  if (ipLimited) return ipLimited;

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid request body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  const { userId, token, backupCode } = parsed.data;

  // Layer 2: per-userId rate limit. Defends distributed-IP brute-force on a
  // single known account — much tighter than the per-IP limit because the
  // 6-digit TOTP space is small (10^6) and we only allow 5 guesses / 15min.
  const userLimited = await rateLimit(req, {
    key: "mfa-verify-user",
    limit: 5,
    windowMs: 15 * 60_000,
    identifier: userId,
  });
  if (userLimited) return userLimited;

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return errorJson("Invalid credentials", 401, "INVALID_CREDENTIALS");

  // Same gates as the login route.
  if (user.status !== "ACTIVE") {
    return errorJson("Your account is not active. Please contact support.", 403, "ACCOUNT_NOT_ACTIVE");
  }
  if (!user.emailVerified) {
    return errorJson("Please verify your email before signing in.", 403, "EMAIL_NOT_VERIFIED");
  }
  // Defense in depth: if MFA isn't enabled on this account, the verify
  // route is the wrong door — refuse rather than accidentally creating a
  // session for a user who skipped MFA.
  if (!user.mfaEnabled) {
    return errorJson("MFA is not enabled for this account.", 400, "MFA_NOT_ENABLED");
  }

  const ip = readIp(req.headers);
  const ua = req.headers.get("user-agent") ?? undefined;

  // Verify the supplied credential. Either a 6-digit TOTP or a one-time
  // backup code.
  let ok = false;
  let usedBackup = false;
  if (token) {
    ok = await verifyToken(userId, token);
  } else if (backupCode) {
    ok = await verifyBackupCode(userId, backupCode);
    usedBackup = ok;
  }

  if (!ok) {
    await audit({
      userId,
      action: "MFA_VERIFY_FAILED",
      category: "AUTH",
      severity: "WARN",
      ip,
      userAgent: ua,
      metadata: { method: usedBackup ? "backup" : token ? "totp" : "none" },
    }).catch(() => null);
    return errorJson("Invalid verification code", 401, "INVALID_MFA_TOKEN");
  }

  // Success — create the session (same shape as /api/auth/login's success
  // path so the client can store tokens + setUser with the same code).
  const { sessionToken, refreshToken } = await createSession(userId, { ip, userAgent: ua });

  // Set refresh token as HttpOnly cookie.
  const c = await cookies();
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  c.set("tp_refresh", refreshToken, {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "lax" : "none",
    path: "/api/auth/refresh",
    expires: refreshExpiresAt,
    secure: true,
  });

  // Record device info on the session row (mirrors the login route).
  if (ua) {
    const deviceInfo = extractDeviceInfo(ua);
    await db.session.updateMany({
      where: { userId, revokedAt: null, ip: ip ?? null },
      data: { deviceInfo },
    }).catch(() => null);
  }

  await audit({
    userId,
    action: "USER_LOGIN",
    category: "AUTH",
    ip,
    userAgent: ua,
    metadata: { mfa: true, method: usedBackup ? "backup" : "totp" },
  });

  return json({
    data: {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      phone: user.phone,
      kycTier: user.kycTier,
      kycStatus: user.kycStatus,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      role: user.role,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      hasTransactionPin: !!user.transactionPinHash,
      authProvider: user.googleId ? "google" : "password",
      createdAt: user.createdAt.toISOString(),
      // SECURITY: Tokens set as HttpOnly cookies, never in response body.
    },
  });
}
