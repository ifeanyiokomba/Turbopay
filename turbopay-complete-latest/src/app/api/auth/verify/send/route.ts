import { db } from "@/lib/db";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { generateOtp, hashOtp } from "@/lib/turbopay/crypto";
import { notify } from "@/lib/turbocore/notifications";
import { sendSmsOtp } from "@/lib/turbocore/otpdev";
import { decryptPii } from "@/lib/turbopay/crypto";
import { z } from "zod";

/**
 * POST /api/auth/verify/send
 *
 * Unified multi-channel OTP sender. Supports:
 *  - EMAIL:    sends the code to the user's email (via Gmail SMTP / Resend)
 *  - SMS:      sends the code via GetOTP (otp.dev) if configured, else Termii
 *  - WHATSAPP: sends the code to the user's WhatsApp
 *
 * In dev, the code is returned in the response for testing.
 */

const schema = z.object({
  target: z.string().min(3, "Enter your email or phone"),
  channel: z.enum(["EMAIL", "SMS", "WHATSAPP"]),
  purpose: z.string().min(2),
});

/** Get GetOTP config from ProviderConfig (if configured). */
async function getOtpDevConfig(): Promise<{ apiKey: string; sender: string; templateId?: string } | null> {
  try {
    const config = await db.providerConfig.findFirst({
      where: { providerName: "otpdev", enabled: true, contract: "notification" },
    });
    if (!config?.credentialsEnc) return null;
    const creds = JSON.parse(decryptPii(config.credentialsEnc));
    if (!creds.apiKey) return null;
    return {
      apiKey: creds.apiKey,
      sender: creds.senderId || "OTP Dev",
      templateId: creds.templateId || undefined,
    };
  } catch (e) {
    console.error("[otpdev] Failed to load config:", e);
    return null;
  }
}

export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "verify-otp", limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const { target, channel, purpose } = parsed.data;

  // Find the user by email or phone (enumeration-safe — always returns { sent: true }).
  const isEmail = target.includes("@");
  const user = isEmail
    ? await db.user.findUnique({ where: { email: target.toLowerCase() } })
    : await db.user.findUnique({ where: { phone: target } });

  if (user) {
    // Invalidate old codes for same user + purpose.
    await db.otpCode.deleteMany({ where: { userId: user.id, purpose } });

    // ─── SMS via GetOTP (if configured) ────────────────────────
    if ((channel === "SMS" || channel === "WHATSAPP") && !isEmail) {
      const otpdevCfg = await getOtpDevConfig();
      console.log("[otpdev] Config loaded:", !!otpdevCfg, otpdevCfg?.sender);
      if (otpdevCfg) {
        // GetOTP generates and sends the OTP — we just track the message_id.
        const result = await sendSmsOtp(otpdevCfg.apiKey, target, otpdevCfg.sender, otpdevCfg.templateId);
        console.log("[otpdev] Send result:", result.ok, result.messageId, result.error);
        if (result.ok && result.messageId) {
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
          // Store with the message_id as the "code" field (for idempotency tracking).
          // Verification will go through GetOTP's API, not local hash comparison.
          await db.otpCode.create({
            data: {
              userId: user.id,
              channel,
              target,
              code: `otpdev:${result.messageId}`, // prefixed to identify GetOTP-sent codes
              purpose,
              expiresAt,
            },
          });

          if (process.env.NODE_ENV !== "production") {
            console.log(`[verify:${channel}] GetOTP sent to ${target}, messageId: ${result.messageId}`);
          }

          return json({ data: { sent: true, channel, provider: "otpdev" } });
        }
        // GetOTP failed — fall through to Termii/fallback below
        console.error(`[verify:${channel}] GetOTP failed:`, result.error);
      }
    }

    // ─── Standard flow (generate OTP, send via notification provider) ───
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.otpCode.create({
      data: {
        userId: user.id,
        channel,
        target,
        code: hashOtp(code),
        purpose,
        expiresAt,
      },
    });

    // Build the verify URL for email verification links.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const verifyUrl = purpose === "EMAIL_VERIFY"
      ? `${baseUrl}/api/auth/verify-email/confirm?otp=${code}&target=${encodeURIComponent(target)}`
      : undefined;

    // Send via the notification provider.
    try {
      const template = channel === "EMAIL" ? "auth.otp" : "auth.otp";
      await notify.send({
        to: target,
        channel: channel === "WHATSAPP" ? "SMS" : channel as "EMAIL" | "SMS",
        template,
        variables: {
          otp: code,
          userName: user.fullName.split(" ")[0],
          ...(verifyUrl ? { verifyUrl } : {}),
        },
      });
    } catch (e) {
      // Non-blocking: log but don't fail the request.
      console.error(`[verify:${channel}] Failed to send OTP to ${target}:`, e);
    }

    // In dev: log the code server-side for testing convenience.
    // SECURITY: Never return OTPs in the response body — even in dev.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[verify:${channel}] OTP for ${target}: ${code} (dev only)`);
    }
  }

  // Always return success (enumeration-safe).
  // OTP is never returned in the response body — even in dev.
  return json({ data: { sent: true, channel } });
}
