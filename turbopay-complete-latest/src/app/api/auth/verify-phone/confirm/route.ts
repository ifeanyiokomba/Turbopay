import { db } from "@/lib/db";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { verifyOtp } from "@/lib/turbopay/otp-verify";
import { hashOtp } from "@/lib/turbopay/crypto";
import { z } from "zod";

const schema = z.object({ phone: z.string(), otp: z.string().min(4).max(10) });

/** POST /api/auth/verify-phone/confirm */
export async function POST(req: Request) {
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message, 422, "VALIDATION");

  // OTP brute-force defense — see /api/auth/reset-password for rationale.
  const limited = await rateLimit(req, { key: "otp-verify", limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  const otpRecord = await db.otpCode.findFirst({
    where: { target: parsed.data.phone, purpose: "PHONE_VERIFY", consumed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otpRecord) return errorJson("Invalid or expired code", 400, "INVALID_OTP");
  if (!verifyOtp(hashOtp(parsed.data.otp), otpRecord.code)) return errorJson("Incorrect code", 400, "INVALID_OTP");

  await db.$transaction([
    db.otpCode.update({ where: { id: otpRecord.id }, data: { consumed: true } }),
    db.user.update({ where: { id: otpRecord.userId! }, data: { phoneVerified: true } }),
  ]);
  await audit({ userId: otpRecord.userId!, action: "PHONE_VERIFIED", category: "AUTH", severity: "INFO" });
  return json({ data: { ok: true } });
}
