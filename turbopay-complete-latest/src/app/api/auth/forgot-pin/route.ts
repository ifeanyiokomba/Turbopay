import { db } from "@/lib/db";
import { requireUser } from "@/lib/turbopay/auth";
import { generateOtp, hashOtp } from "@/lib/turbopay/crypto";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { notify } from "@/lib/turbocore/notifications";

export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "forgot-pin", limit: 3, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const otp = generateOtp();
  await db.recoveryToken.create({
    data: { userId: user.id, channel: "PHONE", target: user.phone ?? "", code: hashOtp(otp), purpose: "RESET_PIN", expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  });

  // Send OTP via the notification provider.
  if (user.phone) {
    try {
      await notify.send({
        to: user.phone,
        channel: "SMS",
        template: "auth.forgot-pin",
        variables: { otp, userName: user.fullName.split(" ")[0] },
      });
    } catch (e) {
      console.error(`[forgot-pin] Failed to send OTP to ${user.phone}:`, e);
    }
  }

  // SECURITY: Never return OTPs in the response body — even in dev.
  // Log server-side only. If NODE_ENV is misconfigured in production,
  // the OTP would be exposed to the client.
  if (process.env.NODE_ENV !== "production") {
    console.log(`[forgot-pin] OTP for ${user.phone}: ${otp} (dev only)`);
  }
  return json({ data: { otpSent: true } });
}
