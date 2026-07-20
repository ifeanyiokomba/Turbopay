import { db } from "@/lib/db";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { verifyOtp } from "@/lib/turbopay/otp-verify";
import { hashOtp } from "@/lib/turbopay/crypto";
import { z } from "zod";

const postSchema = z.object({ email: z.string().email(), otp: z.string().min(4).max(10) });

/**
 * POST /api/auth/verify-email/confirm — verify with { email, otp } in body.
 * GET  /api/auth/verify-email/confirm?otp=XXXX&target=email — verify via link click.
 */
export async function POST(req: Request) {
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message, 422, "VALIDATION");

  const limited = await rateLimit(req, { key: "otp-verify", limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  const email = parsed.data.email.toLowerCase();
  const otpRecord = await db.otpCode.findFirst({
    where: { target: email, purpose: "EMAIL_VERIFY", consumed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otpRecord) return errorJson("Invalid or expired code", 400, "INVALID_OTP");
  if (!verifyOtp(hashOtp(parsed.data.otp), otpRecord.code)) return errorJson("Incorrect code", 400, "INVALID_OTP");

  await db.$transaction([
    db.otpCode.update({ where: { id: otpRecord.id }, data: { consumed: true } }),
    db.user.update({ where: { id: otpRecord.userId! }, data: { emailVerified: true } }),
  ]);
  await audit({ userId: otpRecord.userId!, action: "EMAIL_VERIFIED", category: "AUTH", severity: "INFO" });
  return json({ data: { ok: true } });
}

/**
 * GET /api/auth/verify-email/confirm?token=XXXX (preferred) or ?otp=XXXX&target=email (legacy)
 * Handles email verification link clicks. Verifies and redirects to login page.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const otp = url.searchParams.get("otp");
  const target = url.searchParams.get("target");

  const limited = await rateLimit(req, { key: "otp-verify", limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let otpRecord;

  if (token) {
    // Preferred: look up by single-use verification token (OTP never in URL).
    otpRecord = await db.otpCode.findFirst({
      where: {
        verificationToken: token,
        purpose: "EMAIL_VERIFY",
        consumed: false,
        expiresAt: { gt: new Date() },
      },
    });
  } else if (otp && target) {
    // Legacy: look up by target email (OTP in URL — deprecated, kept for backward compat).
    const email = target.toLowerCase();
    otpRecord = await db.otpCode.findFirst({
      where: { target: email, purpose: "EMAIL_VERIFY", consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
  } else {
    return new Response("Invalid verification link", { status: 400 });
  }

  if (!otpRecord) {
    return Response.redirect(`${baseUrl}?verified=failed`, 302);
  }

  // If using token-based lookup, we already have the record — skip OTP verification.
  // If using legacy OTP lookup, verify the OTP code.
  if (!token && otp) {
    if (!verifyOtp(hashOtp(otp), otpRecord.code)) {
      return Response.redirect(`${baseUrl}?verified=failed`, 302);
    }
  }

  await db.$transaction([
    db.otpCode.update({ where: { id: otpRecord.id }, data: { consumed: true } }),
    db.user.update({ where: { id: otpRecord.userId! }, data: { emailVerified: true } }),
  ]);
  await audit({ userId: otpRecord.userId!, action: "EMAIL_VERIFIED", category: "AUTH", severity: "INFO" });

  return Response.redirect(`${baseUrl}?verified=success`, 302);
}
