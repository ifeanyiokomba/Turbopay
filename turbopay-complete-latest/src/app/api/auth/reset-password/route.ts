import { db } from "@/lib/db";
import { hashPassword, hashOtp } from "@/lib/turbopay/crypto";
import { verifyOtp } from "@/lib/turbopay/otp-verify";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { z } from "zod";

const schema = z.object({
  identifier: z.string().min(3),
  otp: z.string().regex(/^\d{6}$/),
  newPassword: z.string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one digit"),
});

export async function POST(req: Request) {
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  // OTP brute-force defense: a 6-digit OTP has 10^6 combos — without this limit
  // an attacker with a known email can spray all 1M codes in minutes.
  // 5 attempts / 15 min / IP matches the standard OTP-throttle envelope.
  const limited = await rateLimit(req, { key: "otp-verify", limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  const id = parsed.data.identifier.trim().toLowerCase();
  const user = await db.user.findFirst({ where: { OR: [{ email: id }, { phone: parsed.data.identifier.trim() }, { username: id }] } });
  if (!user) return errorJson("Invalid or expired OTP", 400, "INVALID_OTP");

  // Find the OTP record — code is stored as a SHA-256 hash, so we fetch
  // by user+purpose and verify the hash in memory (can't query by hash in WHERE).
  const otpRecord = await db.otpCode.findFirst({
    where: {
      userId: user.id,
      purpose: "RESET_PASSWORD",
      consumed: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!otpRecord || !verifyOtp(hashOtp(parsed.data.otp), otpRecord.code)) return errorJson("Invalid or expired OTP", 400, "INVALID_OTP");

  // Consume OTP + update password.
  await db.otpCode.update({ where: { id: otpRecord.id }, data: { consumed: true } });
  await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(parsed.data.newPassword) } });
  // Revoke all sessions (force re-login).
  await db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ userId: user.id, action: "PASSWORD_RESET", category: "AUTH", severity: "WARN" });

  return json({ data: { ok: true } });
}
