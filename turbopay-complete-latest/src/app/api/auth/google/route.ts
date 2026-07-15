import { db } from "@/lib/db";
import { createSession, readIp } from "@/lib/turbopay/auth";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { z } from "zod";
import { cookies } from "next/headers";

/**
 * POST /api/auth/google
 *
 * Receives a Google ID token (JWT) from the client-side Google Identity
 * Services button. Verifies it via Google's tokeninfo endpoint, then
 * finds-or-creates the user + creates a session.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID — the OAuth 2.0 Client ID from Google Cloud Console
 */

const schema = z.object({
  credential: z.string().min(10, "Google credential is required"),
  country: z.string().min(2).max(2).default("NG"), // ISO 3166-1 alpha-2, detected client-side via IP geolocation
});

interface GoogleUserInfo {
  aud?: string; // token audience
  sub: string; // Google user ID
  email: string;
  email_verified: string; // "true" | "false"
  name: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

export async function POST(req: Request) {
  // Rate limit: 5 requests/min per IP to prevent token spam.
  const limited = await rateLimit(req, { key: "google-auth", limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message, 422, "VALIDATION");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return errorJson("Google OAuth is not configured. Set GOOGLE_CLIENT_ID in .env", 500, "GOOGLE_NOT_CONFIGURED");
  }

  // Verify the Google ID token via Google's tokeninfo endpoint.
  // SECURITY NOTE: The token is passed as a URL query parameter, which means
  // it may appear in HTTP access logs, proxy logs, and CDN logs. For higher
  // security, use the `google-auth-library` npm package for local JWT
  // verification (avoids sending the token over the network a second time).
  // The current approach is acceptable because: (1) the token is short-lived
  // (~1 hour), (2) Google's tokeninfo endpoint is HTTPS, and (3) the token
  // is only valid for our GOOGLE_CLIENT_ID (audience check below).
  let googleUser: GoogleUserInfo;
  try {
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(parsed.data.credential)}`,
      { method: "GET" }
    );
    if (!tokenInfoRes.ok) {
      return errorJson("Invalid Google credential", 401, "INVALID_GOOGLE_TOKEN");
    }
    const tokenInfo = await tokenInfoRes.json() as GoogleUserInfo;

    // Verify the token is for our client.
    if (tokenInfo.aud !== clientId) {
      return errorJson("Google token audience mismatch", 401, "TOKEN_AUDIENCE_MISMATCH");
    }

    // Only proceed if email is verified.
    if (tokenInfo.email_verified !== "true") {
      return errorJson("Google email is not verified", 400, "EMAIL_NOT_VERIFIED");
    }

    googleUser = tokenInfo;
  } catch (e: any) {
    return errorJson(`Google token verification failed: ${e.message}`, 401, "GOOGLE_VERIFY_FAILED");
  }

  const email = googleUser.email.toLowerCase();
  const ip = readIp(req.headers);
  const ua = req.headers.get("user-agent") ?? undefined;

  // Find existing user by googleId or email.
  let user = await db.user.findFirst({
    where: { OR: [{ googleId: googleUser.sub }, { email }] },
  });

  if (user) {
    // Link Google ID if not already linked.
    if (!user.googleId) {
      user = await db.user.update({
        where: { id: user.id },
        data: {
          googleId: googleUser.sub,
          googlePicture: googleUser.picture ?? null,
          // If the user didn't have a password (OAuth user), keep it null.
          // If they did have a password, keep it — they can still log in both ways.
        },
      });
    }
  } else {
    // Create a new user from Google profile.
    // phone and passwordHash are null — user must set them during onboarding.
    // country is detected client-side via IP geolocation and sent with the credential.
    user = await db.user.create({
      data: {
        fullName: googleUser.name || `${googleUser.given_name ?? ""} ${googleUser.family_name ?? ""}`.trim(),
        email,
        country: parsed.data.country.toUpperCase(),
        phone: null, // set during onboarding
        passwordHash: null, // OAuth users don't have a password
        googleId: googleUser.sub,
        googlePicture: googleUser.picture ?? null,
        kycTier: 1,
        kycStatus: "UNVERIFIED",
        emailVerified: true, // Google already verified the email
        phoneVerified: false,
        role: "USER",
      },
    });
    await ensureWallet(user.id, `${user.fullName} - Turbopay`, parsed.data.country.toUpperCase());
  }

  if (user.status !== "ACTIVE") {
    return errorJson("Your account is not active. Please contact support.", 403, "ACCOUNT_NOT_ACTIVE");
  }

  // Create session.
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

  await audit({ userId: user.id, action: "GOOGLE_LOGIN", category: "AUTH", ip, userAgent: ua });

  const fullName = user.fullName;
  return json({
    data: {
      id: user.id,
      fullName,
      username: user.username,
      kycTier: user.kycTier,
      kycStatus: user.kycStatus,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      role: user.role,
      hasTransactionPin: !!user.transactionPinHash,
      authProvider: "google",
      createdAt: user.createdAt.toISOString(),
      // PII minimization: email, phone, avatarUrl excluded from login response.
      // SECURITY: Tokens set as HttpOnly cookies, never in response body.
    },
  });
}
