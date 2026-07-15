import { db } from "@/lib/db";
import { requireUser } from "@/lib/turbopay/auth";
import { hashPin, hashOtp } from "@/lib/turbopay/crypto";
import { verifyOtp } from "@/lib/turbopay/otp-verify";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { z } from "zod";

const schema = z.object({ otp: z.string().regex(/^\d{6}$/), newPin: z.string().regex(/^\d{4}$/) });

export async function POST(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  // OTP brute-force defense — see /api/auth/reset-password for rationale.
  const limited = await rateLimit(req, { key: "otp-verify", limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;
  const token = await db.recoveryToken.findFirst({
    where: { userId: user.id, purpose: "RESET_PIN", consumed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!token || !verifyOtp(hashOtp(parsed.data.otp), token.code)) return errorJson("Invalid or expired OTP", 400, "INVALID_OTP");
  await db.recoveryToken.update({ where: { id: token.id }, data: { consumed: true } });
  await db.user.update({ where: { id: user.id }, data: { transactionPinHash: hashPin(parsed.data.newPin), pinSetAt: new Date(), pinFailCount: 0, pinLockedUntil: null } });
  await audit({ userId: user.id, action: "PIN_RESET_VIA_OTP", category: "AUTH", severity: "WARN" });
  return json({ data: { ok: true } });
}
