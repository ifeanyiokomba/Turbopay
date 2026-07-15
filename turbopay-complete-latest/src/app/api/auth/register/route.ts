import { db } from "@/lib/db";
import { createSession, readIp, AuthError } from "@/lib/turbopay/auth";
import { hashPassword } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { isPasswordBreached } from "@/lib/turbopay/breach-check";
import { referrals } from "@/lib/turbocore/referrals";
import { z } from "zod";
import { cookies } from "next/headers";

const schema = z.object({
  fullName: z.string().min(2, "Enter your full name"),
  username: z.string().min(3, "Username must be at least 3 characters").max(20, "Username must be at most 20 characters").regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores").optional(),
  email: z.string().email("Enter a valid email").optional(),
  country: z.string().min(2).max(2).default("NG"), // ISO 3166-1 alpha-2
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Use international format: +<country code><number>").optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password must be at most 128 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  privacyPolicyAccepted: z.literal(true).refine(() => true, { message: "You must accept the Privacy Policy to create an account" }),
  referralCode: z.string().optional(),
  verifyChannel: z.enum(["EMAIL", "SMS", "WHATSAPP"]).default("EMAIL"),
}).refine((data) => data.email || data.phone, {
  message: "Provide at least an email or phone number",
  path: ["email"],
});

export async function POST(req: Request) {
  // Rate limit: 5 registrations per hour per IP (mass-account defense).
  const limited = await rateLimit(req, { key: "register", limit: 5, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");
  }
  const { fullName, username, email, country, phone, password, referralCode } = parsed.data;

  // BREACH CHECK — HaveIBeenPwned k-anonymity. SOFT check: if the HIBP API
  // is unreachable (network error, timeout, non-200), `isPasswordBreached`
  // returns `false` and registration proceeds. We never block account
  // creation on a third-party outage. Only reject when we have a positive
  // confirmation that the password is in a known breach corpus.
  try {
    const breached = await isPasswordBreached(password);
    if (breached) {
      return errorJson(
        "This password has been found in known data breaches. Please choose a different password.",
        422,
        "BREACHED_PASSWORD",
      );
    }
  } catch {
    // Defensive: isPasswordBreached already swallows errors internally and
    // returns false, but a defensive try/catch ensures NO uncaught throw
    // can block registration. Fail open — log nothing (PII risk).
  }

  // Check email/phone/username uniqueness.
  // SECURITY: return a single generic message + code regardless of WHICH
  // identifier collided. Specific messages ("email already exists" vs
  // "phone already exists" vs "username taken") let an attacker probe which
  // emails / phones / usernames are registered by submitting registrations
  // with one varying identifier — a classic user-enumeration vector. The
  // generic message closes that channel: the response is identical whether
  // the email, phone, or username is the duplicate.
  const orClauses: any[] = [];
  if (email) orClauses.push({ email: email.toLowerCase() });
  if (phone) orClauses.push({ phone });
  if (username) orClauses.push({ username: username.toLowerCase() });
  if (orClauses.length > 0) {
    const exists = await db.user.findFirst({ where: { OR: orClauses } });
    if (exists) {
      return errorJson(
        "An account with these details already exists.",
        409,
        "DUPLICATE_DETAILS",
      );
    }
  }

  // Determine verification channel: if only phone provided, default to SMS.
  // If only email provided, default to EMAIL. If both, use the specified channel.
  const effectiveChannel = !email ? "SMS" : !phone ? "EMAIL" : parsed.data.verifyChannel;

  const user = await db.user.create({
    data: {
      fullName,
      username: username ? username.toLowerCase() : null,
      email: email ? email.toLowerCase() : null,
      country: country.toUpperCase(),
      phone: phone ?? null,
      passwordHash: hashPassword(password),
      kycTier: 1,
      kycStatus: "UNVERIFIED",
      emailVerified: !email, // If no email, consider it "verified" (nothing to verify)
      phoneVerified: false,
      role: "USER",
      privacyPolicyAccepted: true,
      privacyPolicyAcceptedAt: new Date(),
    },
  });
  await ensureWallet(user.id, `${fullName} - Turbopay`, country.toUpperCase());

  // Best-effort referral completion. A referral code is OPTIONAL — if the
  // user wasn't referred, or the code is invalid/expired/self-referral, the
  // registration MUST still succeed. `completeReferral` is a no-op when the
  // code doesn't match a PENDING referral row.
  if (referralCode && referralCode.trim().length > 0) {
    try {
      await referrals.completeReferral(referralCode.trim().toUpperCase(), user.id);
    } catch (err: any) {
      // Log but never fail registration — referrals are a perk.
      console.error("[referrals] completeReferral failed", {
        referredUserId: user.id, referralCode, error: err?.message ?? err,
      });
    }
  }

  const ip = readIp(req.headers);
  const ua = req.headers.get("user-agent") ?? undefined;
  const { sessionToken, refreshToken } = await createSession(user.id, { ip, userAgent: ua });

  // Set refresh token as HttpOnly cookie (same as login route).
  const c = await cookies();
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  c.set("tp_refresh", refreshToken, {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "lax" : "none",
    path: "/api/auth/refresh",
    expires: refreshExpiresAt,
    secure: true,
  });

  await audit({ userId: user.id, action: "USER_REGISTERED", category: "AUTH", ip, userAgent: ua });

  // Auto-send verification OTP via the chosen channel — the user must verify
  // before they can log in. The OTP is NEVER returned in the response body
  // (even in dev) — that was an account-takeover vector on misconfigured envs.
  // If no email was provided, skip email verification (phone-only account).
  try {
    const { generateOtp, hashOtp } = await import("@/lib/turbopay/crypto");
    const { notify } = await import("@/lib/turbocore/notifications");
    const purpose = effectiveChannel === "SMS" ? "PHONE_VERIFY" : "EMAIL_VERIFY";
    await db.otpCode.deleteMany({ where: { userId: user.id, purpose } });
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const target = effectiveChannel === "SMS" ? phone : email;
    if (target) {
      await db.otpCode.create({
        data: { userId: user.id, channel: effectiveChannel, target, code: hashOtp(code), purpose, expiresAt },
      });

      // Build verification link for email channel.
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const verifyUrl = effectiveChannel === "EMAIL"
        ? `${baseUrl}/api/auth/verify-email/confirm?otp=${code}&target=${encodeURIComponent(target)}`
        : undefined;

      // Send the verification email/SMS via the notification provider.
      await notify.send({
        to: target,
        channel: effectiveChannel === "WHATSAPP" ? "SMS" : effectiveChannel as "EMAIL" | "SMS",
        template: "auth.verify-email",
        variables: {
          otp: code,
          userName: fullName.split(" ")[0],
          ...(verifyUrl ? { verifyUrl } : {}),
        },
      });

      // Log the OTP server-side for dev/staging convenience (never to the client).
      if (process.env.NODE_ENV !== "production") {
        console.info(`[register] OTP for ${target}: ${code}`);
      }
    }
  } catch (e) { /* best-effort — don't fail registration if OTP sending fails */ console.error("[register] OTP send error:", e); }

  return json({
    data: {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      kycTier: user.kycTier,
      kycStatus: user.kycStatus,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      role: user.role,
      hasTransactionPin: false,
      authProvider: "password",
      createdAt: user.createdAt.toISOString(),
      // PII minimization: email, phone, avatarUrl, bio excluded.
      // SECURITY: Tokens are set as HttpOnly cookies, never returned in body.
    },
  });
}
