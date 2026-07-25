import { db } from "@/lib/db";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { generateOtp, hashOtp } from "@/lib/turbopay/crypto";
import { sendSmsOtp } from "@/lib/turbocore/otpdev";
import { notify } from "@/lib/turbocore/notifications";
import { decryptPii } from "@/lib/turbopay/crypto";
import { normalizePhone } from "@/lib/turbocore/config/country-currency";
import { z } from "zod";

const schema = z.object({ 
  phone: z.string().regex(/^(\+[1-9]\d{6,14}|[0-9]{7,15})$/, "Enter a valid phone number"),
  country: z.string().min(2).max(2).default("NG"),
});

/** Get OTPDev config from ProviderConfig. */
async function getOtpDevConfig(): Promise<{ apiKey: string; sender: string; templateId?: string } | null> {
  try {
    const { db } = await import("@/lib/db");
    const { decryptPii } = await import("@/lib/turbopay/crypto");
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
  } catch {
    return null;
  }
}

/** POST /api/auth/verify-phone/send — enumeration-safe. */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "verify-phone", limit: 3, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message, 422, "VALIDATION");

  // Normalize phone with country code
  const phone = normalizePhone(parsed.data.phone, parsed.data.country);
  
  const user = await db.user.findUnique({ where: { phone } });
  if (user && !user.phoneVerified) {
    await db.otpCode.deleteMany({ where: { userId: user.id, purpose: "PHONE_VERIFY" } });
    
    // Try OTPDev first
    const otpdevCfg = await getOtpDevConfig();
    if (otpdevCfg) {
      const result = await sendSmsOtp(otpdevCfg.apiKey, phone, otpdevCfg.sender, otpdevCfg.templateId, 4);
      if (result.ok && result.messageId) {
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await db.otpCode.create({ 
          data: { userId: user.id, channel: "SMS", target: phone, code: `otpdev:${result.messageId}`, purpose: "PHONE_VERIFY", expiresAt } 
        });
        return json({ data: { sent: true, provider: "otpdev" } });
      }
    }
    
    // Fallback to local OTP + send via notification providers
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.otpCode.create({ data: { userId: user.id, channel: "PHONE", target: phone, code: hashOtp(code), purpose: "PHONE_VERIFY", expiresAt } });
    
    // Send OTP via configured notification providers (Termii SMS, etc.)
    await notify.send({
      to: phone,
      channel: "SMS",
      template: "auth.otp",
      variables: { otp: code, userName: user.fullName?.split(" ")[0] || "User" },
      userId: user.id,
    }).catch(() => null);
    
    if (process.env.NODE_ENV !== "production") {
      console.log(`[verify-phone] OTP for ${phone}: ${code} (dev only)`);
    }
  }
  return json({ data: { sent: true } });
}
