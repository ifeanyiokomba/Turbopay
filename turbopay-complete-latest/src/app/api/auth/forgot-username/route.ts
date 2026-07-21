import { db } from "@/lib/db";
import { generateOtp, hashOtp } from "@/lib/turbopay/crypto";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { notify } from "@/lib/turbocore/notifications";
import crypto from "crypto";
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
    const channel = user.email ? "EMAIL" : "PHONE";
    const target = (user.email ?? user.phone) as string;

    await db.recoveryToken.create({
      data: {
        userId: user.id,
        channel,
        target,
        code: hashOtp(otp),
        purpose: "RECOVER_USERNAME",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    // Send the OTP via the notification provider.
    try {
      await notify.send({
        to: target,
        channel: channel as "EMAIL" | "SMS",
        template: "auth.otp",
        variables: {
          otp,
          userName: user.fullName.split(" ")[0],
        },
      });
    } catch (e) {
      console.error(`[forgot-username] Failed to send OTP to ${target}:`, (e as Error).message);
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(`[forgot-username] OTP for ${target}: ${otp} (dev only)`);
    }
  }
  return json({ data: { otpSent: true } });
}
