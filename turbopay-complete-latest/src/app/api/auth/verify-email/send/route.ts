import { db } from "@/lib/db";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { generateOtp, hashOtp } from "@/lib/turbopay/crypto";
import { notify } from "@/lib/turbocore/notifications";
import { z } from "zod";

const schema = z.object({ email: z.string().email() });

/** POST /api/auth/verify-email/send — enumeration-safe. */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "verify-email", limit: 3, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson("Invalid email", 422, "VALIDATION");

  const email = parsed.data.email.toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (user && !user.emailVerified) {
    // Invalidate old codes for same user+purpose.
    await db.otpCode.deleteMany({ where: { userId: user.id, purpose: "EMAIL_VERIFY" } });
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.otpCode.create({ data: { userId: user.id, channel: "EMAIL", target: email, code: hashOtp(code), purpose: "EMAIL_VERIFY", expiresAt } });

    // Send verification email via the notification provider.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const verifyUrl = `${baseUrl}/api/auth/verify-email/confirm?otp=${code}&target=${encodeURIComponent(email)}`;

    await notify.send({
      to: email,
      channel: "EMAIL",
      template: "auth.verify-email",
      variables: { otp: code, userName: user.fullName, verifyUrl },
      userId: user.id,
    }).catch((err) => {
      // Log but don't fail the request — the OTP is stored in DB for retry.
      console.error("[verify-email] Failed to send verification email:", err);
    });
  }
  return json({ data: { sent: true } });
}
