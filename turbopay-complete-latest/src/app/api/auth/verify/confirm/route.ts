import { db } from "@/lib/db";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { verifyOtp } from "@/lib/turbopay/otp-verify";
import { hashOtp, decryptPii } from "@/lib/turbopay/crypto";
import { verifySmsOtp } from "@/lib/turbocore/otpdev";
import { z } from "zod";

/**
 * POST /api/auth/verify/confirm
 *
 * Unified multi-channel OTP confirmation. Works for any channel (EMAIL / SMS /
 * WHATSAPP) and any purpose (EMAIL_VERIFY / PHONE_VERIFY / RESET_PASSWORD etc.).
 *
 * When the OTP was sent via GetOTP (code starts with "otpdev:"), verification
 * goes through GetOTP's API. Otherwise, local hash comparison is used.
 *
 * Body: { target: string, otp: string, purpose: string }
 */

const schema = z.object({
  target: z.string().min(3),
  otp: z.string().min(4).max(10),
  purpose: z.string().min(2),
});

/** Get the GetOTP API key from ProviderConfig (if configured). */
async function getOtpDevApiKey(): Promise<string | null> {
  try {
    const config = await db.providerConfig.findFirst({
      where: { providerName: "otpdev", enabled: true, contract: "notification" },
    });
    if (!config?.credentialsEnc) return null;
    const creds = JSON.parse(decryptPii(config.credentialsEnc));
    return creds.apiKey || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "otp-verify", limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const { target, otp, purpose } = parsed.data;

  const otpRecord = await db.otpCode.findFirst({
    where: { target, purpose, consumed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!otpRecord) return errorJson("Invalid or expired code", 400, "INVALID_OTP");

  // ─── GetOTP verification (code was sent via GetOTP) ──────────
  if (otpRecord.code.startsWith("otpdev:")) {
    const otpdevKey = await getOtpDevApiKey();
    if (otpdevKey) {
      const result = await verifySmsOtp(otpdevKey, otp, target);
      if (!result.ok || !result.valid) {
        return errorJson("Incorrect code", 400, "INVALID_OTP");
      }
      // GetOTP verified — proceed to consume and mark verified below.
    } else {
      return errorJson("OTP provider unavailable", 503, "PROVIDER_UNAVAILABLE");
    }
  } else {
    // ─── Standard local verification (hash comparison) ──────────
    if (!verifyOtp(hashOtp(otp), otpRecord.code)) {
      return errorJson("Incorrect code", 400, "INVALID_OTP");
    }
  }

  // Consume the OTP.
  await db.otpCode.update({ where: { id: otpRecord.id }, data: { consumed: true } });

  // Mark the channel as verified.
  if (otpRecord.userId) {
    if (purpose === "EMAIL_VERIFY") {
      await db.user.update({ where: { id: otpRecord.userId }, data: { emailVerified: true } });
    } else if (purpose === "PHONE_VERIFY") {
      await db.user.update({ where: { id: otpRecord.userId }, data: { phoneVerified: true } });
    }
    await audit({ userId: otpRecord.userId, action: `${purpose}_VERIFIED`, category: "AUTH", severity: "INFO", metadata: { channel: otpRecord.channel } });
  }

  return json({ data: { ok: true, userId: otpRecord.userId } });
}
