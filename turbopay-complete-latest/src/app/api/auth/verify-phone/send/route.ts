import { db } from "@/lib/db";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { generateOtp, hashOtp } from "@/lib/turbopay/crypto";
import { z } from "zod";

const schema = z.object({ phone: z.string().regex(/^\+234[0-9]{10}$/) });

/** POST /api/auth/verify-phone/send — enumeration-safe. */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "verify-phone", limit: 3, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message, 422, "VALIDATION");

  const phone = parsed.data.phone;
  const user = await db.user.findUnique({ where: { phone } });
  if (user && !user.phoneVerified) {
    await db.otpCode.deleteMany({ where: { userId: user.id, purpose: "PHONE_VERIFY" } });
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.otpCode.create({ data: { userId: user.id, channel: "PHONE", target: phone, code: hashOtp(code), purpose: "PHONE_VERIFY", expiresAt } });
    if (process.env.NODE_ENV !== "production") {
      console.log(`[verify-phone] OTP for ${phone}: ${code} (dev only)`);
    }
  }
  return json({ data: { sent: true } });
}
