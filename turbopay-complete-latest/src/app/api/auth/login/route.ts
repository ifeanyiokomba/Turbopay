import { db } from "@/lib/db";
import { createSession, readIp } from "@/lib/turbopay/auth";
import { verifyPassword, dummyHash } from "@/lib/turbopay/crypto";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { extractDeviceInfo } from "@/lib/turbopay/device-info";
import { registerDevice, recordSecurityEvent } from "@/lib/turbocore/security";
import { z } from "zod";
import { cookies } from "next/headers";

const schema = z.object({
  identifier: z.string().min(3, "Enter your email, phone, or username"),
  password: z.string().min(1, "Enter your password"),
});

// ─── Per-user failed-login lockout ─────────────────────────────
// Mirrors the transaction-PIN lockout in pin.ts: after 5 consecutive
// password failures the account is locked for 15 minutes. This defeats
// distributed-IP brute-force against a known email — even if an attacker
// rotates across N source IPs, the failure counter is keyed on the USER
// row, not the IP.
const LOGIN_LOCK_THRESHOLD = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(req: Request) {
  try {
  // Layer 1: per-IP rate limit (defends a single source spamming many accounts).
  const ipLimited = await rateLimit(req, { key: "login", limit: 10, windowMs: 60_000 });
  if (ipLimited) return ipLimited;

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid request body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  const { identifier, password } = parsed.data;
  const id = identifier.trim().toLowerCase();

  // Layer 2: per-identifier rate limit (defeats distributed-IP brute-force on a
  // single known account — 10 attempts / 15 min regardless of source IP).
  // Keyed on the normalised identifier rather than userId because the user is
  // not yet authenticated and may not even exist.
  const idLimited = await rateLimit(req, {
    key: "login-user",
    limit: 10,
    windowMs: 15 * 60 * 1000,
    identifier: id,
  });
  if (idLimited) return idLimited;

  // Login by email, phone, or username.
  const user = await db.user.findFirst({
    where: { OR: [{ email: id }, { phone: identifier.trim() }, { username: id }] },
  });

  // Enforce per-user lockout BEFORE the (timing-safe) password verification.
  // If the account is locked, refuse even the correct password — the user must
  // wait out the window. This makes brute-force economically infeasible.
  if (user?.loginLockedUntil && user.loginLockedUntil > new Date()) {
    const retryAfterSec = Math.max(1, Math.ceil((user.loginLockedUntil.getTime() - Date.now()) / 1000));
    return errorJson(
      "Account temporarily locked due to too many failed login attempts. Please try again later.",
      423,
      "ACCOUNT_LOCKED",
      undefined,
      { "Retry-After": String(retryAfterSec) },
    );
  }

  // Always run a full scrypt verification (dummyHash when the user is unknown)
  // so the response time is indistinguishable between "no such user" and
  // "wrong password" — closes the user-enumeration timing channel.
  const storedHash = user?.passwordHash ?? dummyHash();
  const ok = verifyPassword(password, storedHash);

  const ip = readIp(req.headers);
  const ua = req.headers.get("user-agent") ?? undefined;

  // Log login attempt (success or failure) to LoginHistory.
  await db.loginHistory.create({
    data: {
      userId: user?.id ?? null,
      identifier: id,
      success: !!(user && ok),
      ip: ip ?? null,
      userAgent: ua ?? null,
      errorMessage: (!user || !ok) ? "INVALID_CREDENTIALS" : null,
    },
  }).catch(() => null);

  if (!user || !ok) {
    // On a known-user failure, increment the per-user counter and lock at the
    // threshold. For unknown users we skip the DB write (there is no row to
    // update) — the per-IP and per-identifier rate limits already throttle them.
    if (user) {
      const newCount = (user.loginFailCount ?? 0) + 1;
      const locked = newCount >= LOGIN_LOCK_THRESHOLD;
      await db.user.update({
        where: { id: user.id },
        data: {
          loginFailCount: newCount,
          ...(locked ? { loginLockedUntil: new Date(Date.now() + LOGIN_LOCK_DURATION_MS) } : {}),
        },
      }).catch(() => null);
      await audit({
        userId: user.id,
        action: "LOGIN_FAILED",
        category: "AUTH",
        severity: locked ? "WARN" : "INFO",
        ip,
        userAgent: ua,
        metadata: { failCount: newCount, locked },
      }).catch(() => null);
    }
    return errorJson("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  if (user.status !== "ACTIVE") return errorJson("Your account is not active. Please contact support.", 403, "ACCOUNT_NOT_ACTIVE");

  // Email verification gate — users must verify their email before they can
  // log in. If unverified, return a 403 with EMAIL_NOT_VERIFIED so the client
  // can show the verification UI (send OTP → confirm → retry login).
  if (!user.emailVerified) {
    return errorJson(
      "Please verify your email before signing in. Check your inbox for the verification code.",
      403,
      "EMAIL_NOT_VERIFIED",
    );
  }

  // Success — reset the per-user failure counter and clear any stale lockout.
  if (user.loginFailCount > 0 || user.loginLockedUntil) {
    await db.user.update({
      where: { id: user.id },
      data: { loginFailCount: 0, loginLockedUntil: null },
    }).catch(() => null);
  }

  // ── MFA gate ────────────────────────────────────────────────
  // If MFA is enabled on the account, DON'T create the session yet. Return
  // `mfaRequired: true` + the user id so the client can prompt for a TOTP
  // code. The user then calls /api/auth/mfa/verify with { userId, token }
  // — that route verifies the code + creates the session in one step.
  // Returning the userId here is safe: the password has already been
  // verified, and the /mfa/verify route enforces per-IP + per-userId rate
  // limits so the 6-digit code can't be brute-forced.
  if (user.mfaEnabled) {
    await audit({
      userId: user.id,
      action: "LOGIN_MFA_CHALLENGE",
      category: "AUTH",
      ip,
      userAgent: ua,
    }).catch(() => null);
    return json({
      data: {
        mfaRequired: true,
        userId: user.id,
        // Hint for the UI — whether the user has backup codes available so
        // the "Use a backup code" link can be shown/hidden. We don't leak
        // the codes themselves.
        hasBackupCodes: !!user.mfaBackupCodesEnc,
      },
    });
  }

  // Extract device info from user agent.
  const deviceInfo = ua ? extractDeviceInfo(ua) : null;
  const { sessionToken, refreshToken } = await createSession(user.id, { ip, userAgent: ua });

  // Set the refresh token as a separate HttpOnly cookie. The client never
  // sees this token — the server reads it directly from the cookie during
  // /api/auth/refresh. This eliminates the XSS-vulnerable localStorage
  // refresh token pattern.
  const c = await cookies();
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30d
  c.set("tp_refresh", refreshToken, {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "lax" : "none",
    path: "/api/auth/refresh", // only sent to the refresh endpoint
    expires: refreshExpiresAt,
    secure: true,
  });
  // Update the session with deviceInfo.
  await db.session.updateMany({
    where: { userId: user.id, revokedAt: null, ip: ip ?? null },
    data: { deviceInfo },
  }).catch(() => null);

  await audit({ userId: user.id, action: "USER_LOGIN", category: "AUTH", ip, userAgent: ua });

  // Register the device for the Security Center (device recognition + timeline).
  // Non-blocking: never let device tracking fail the login.
  if (ua) {
    try {
      await registerDevice(user.id, ua, ip ?? null);
      await recordSecurityEvent(user.id, "LOGIN_SUCCESS", { ip, userAgent: ua });
    } catch { /* device tracking is best-effort */ }
  }

  return json({
    data: {
      id: user.id, fullName: user.fullName, username: user.username,
      kycTier: user.kycTier, kycStatus: user.kycStatus, status: user.status,
      emailVerified: user.emailVerified, phoneVerified: user.phoneVerified, role: user.role,
      hasTransactionPin: !!user.transactionPinHash,
      authProvider: user.googleId ? "google" : "password",
      createdAt: user.createdAt.toISOString(),
      // SECURITY: Tokens are NEVER returned in the response body.
      // The access token is set as an HttpOnly cookie by createSession().
      // The refresh token is set as a separate HttpOnly cookie below.
      // This eliminates the XSS-vulnerable localStorage token pattern.
      // For cross-site iframes, the client calls /api/auth/iframe-token
      // to get a short-lived bearer token stored in page memory only.
      //
      // PII minimization: email, phone, avatarUrl, bio are excluded from the
      // login response. The client can fetch /api/profile for full details.
    },
  });
  } catch (error) {
    console.error("[User Login Error]", error);
    return errorJson("Internal server error", 500);
  }
}
