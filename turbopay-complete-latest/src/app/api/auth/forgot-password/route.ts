import { db } from "@/lib/db";
import { generateOtp, hashOtp } from "@/lib/turbopay/crypto";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { notify } from "@/lib/turbocore/notifications";
import { z } from "zod";

const schema = z.object({ identifier: z.string().min(3, "Enter your email, phone, or username") });

export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "forgot-password", limit: 5, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const id = parsed.data.identifier.trim().toLowerCase();
  const user = await db.user.findFirst({ where: { OR: [{ email: id }, { phone: parsed.data.identifier.trim() }, { username: id }] } });

  if (user) {
    // Generate + store OTP for password reset.
    const otp = generateOtp();
    const target = user.email ?? user.phone;
    const channel = user.email ? "EMAIL" : "SMS";

    await db.otpCode.create({
      data: {
        userId: user.id,
        channel,
        target: target ?? "",
        code: hashOtp(otp),
        purpose: "RESET_PASSWORD",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min
      },
    });

    // Send OTP via the notification provider.
    try {
      await notify.send({
        to: target ?? "",
        channel: channel as "EMAIL" | "SMS",
        template: "auth.forgot-password",
        variables: {
          otp,
          userName: user.fullName.split(" ")[0],
        },
      });
    } catch (e) {
      console.error(`[forgot-password] Failed to send OTP to ${target}:`, e);
    }

    // In dev: log the code server-side for testing convenience.
    // SECURITY: Never return OTPs in the response body — even in dev.
    // If NODE_ENV is misconfigured in production, the OTP would be exposed
    // to the client (and any logging infrastructure capturing responses).
    if (process.env.NODE_ENV !== "production") {
      console.log(`[forgot-password] OTP for ${target}: ${otp} (dev only)`);
    }
  }

  // Always return success (don't leak whether the account exists).
  return json({ data: { otpSent: true } });
}
