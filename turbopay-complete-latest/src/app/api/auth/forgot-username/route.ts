import { db } from "@/lib/db";
import { generateOtp, hashOtp } from "@/lib/turbopay/crypto";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { z } from "zod";

const schema = z.object({ identifier: z.string().min(3, "Enter your email or phone") });

export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "forgot-username", limit: 5, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  const id = parsed.data.identifier.trim().toLowerCase();
  const user = await db.user.findFirst({ where: { OR: [{ email: id }, { phone: parsed.data.identifier.trim() }] } });
  if (user) {
    const otp = generateOtp();
    await db.recoveryToken.create({
      data: { userId: user.id, channel: user.email ? "EMAIL" : "PHONE", target: (user.email ?? user.phone) as string, code: hashOtp(otp), purpose: "RECOVER_USERNAME", expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });
    if (process.env.NODE_ENV !== "production") {
      // SECURITY: Never return OTPs or usernames in the response body — even in dev.
      console.log(`[forgot-username] OTP for ${user.email ?? user.phone}: ${otp} (dev only)`);
    }
  }
  return json({ data: { otpSent: true } });
}
