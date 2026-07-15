import { db } from "@/lib/db";
import { createSession, readIp } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { extractDeviceInfo } from "@/lib/turbopay/device-info";
import { verifyPasskeyAuthentication } from "@/lib/turbopay/passkey";
import { audit } from "@/lib/turbopay/audit";
import { z } from "zod";
import { cookies } from "next/headers";

const schema = z.object({
  authenticationResponse: z.any(), // WebAuthn AuthenticationResponseJSON
  challengeId: z.string().min(1), // server-side challenge reference
});

/**
 * POST /api/auth/passkey/authenticate/verify — verify passkey authentication and create session.
 *
 * Supports both modes:
 *   1. Second factor: user already authenticated via password, passkey replaces TOTP
 *   2. Passwordless: user authenticates with passkey only (no password needed)
 */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "passkey-auth", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const result = await verifyPasskeyAuthentication(
    parsed.data.authenticationResponse,
    parsed.data.challengeId
  );

  if (!result.verified || !result.userId) {
    return errorJson("Passkey verification failed", 401, "PASSKEY_AUTH_FAILED");
  }

  // Verify user status
  const user = await db.user.findUnique({ where: { id: result.userId } });
  if (!user) return errorJson("User not found", 401, "USER_NOT_FOUND");
  if (user.status !== "ACTIVE") {
    return errorJson("Your account is not active. Please contact support.", 403, "ACCOUNT_NOT_ACTIVE");
  }

  const ip = readIp(req.headers);
  const ua = req.headers.get("user-agent") ?? undefined;

  // Create session (same as login success)
  const { sessionToken, refreshToken } = await createSession(user.id, { ip, userAgent: ua });

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

  // Record device info
  if (ua) {
    const deviceInfo = extractDeviceInfo(ua);
    await db.session.updateMany({
      where: { userId: user.id, revokedAt: null, ip: ip ?? null },
      data: { deviceInfo },
    }).catch(() => null);
  }

  await audit({
    userId: user.id,
    action: "USER_LOGIN",
    category: "AUTH",
    ip,
    userAgent: ua,
    metadata: { method: "passkey", credentialId: result.credentialId },
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
