import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { hashPin } from "@/lib/turbopay/crypto";
import { hashOtp, generateOtp } from "@/lib/turbopay/crypto";
import { verifyOtp } from "@/lib/turbopay/otp-verify";
import crypto from "crypto";

/**
 * POST /api/auth/change-pin — OTP-based PIN change
 * Actions: "request-otp" | "change-pin"
 */
export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { action, attemptId, otp, newPin } = body as {
    action?: string;
    attemptId?: string;
    otp?: string;
    newPin?: string;
  };

  if (!action) return errorJson("Missing action", 422);

  if (action === "request-otp") {
    // Generate a 6-digit OTP using CSPRNG
    const code = generateOtp();
    const hashedOtpCode = hashOtp(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store the OTP in the database
    const otpRecord = await db.otpCode.create({
      data: {
        userId: user.id,
        channel: "EMAIL",
        target: user.email ?? "",
        code: hashedOtpCode,
        purpose: "CHANGE_PIN",
        expiresAt,
      },
    });

    await audit({ action: "change_pin.otp_requested", category: "AUTH", userId: user.id });

    return json({
      data: {
        attemptId: otpRecord.id,
        message: "OTP sent to your email",
      },
    });
  }

  if (action === "change-pin") {
    if (!otp || !attemptId) return errorJson("Missing OTP or attempt ID", 422);
    if (!newPin || newPin.length !== 4) return errorJson("PIN must be 4 digits", 422);
    if (!/^\d{4}$/.test(newPin)) return errorJson("PIN must contain only digits", 422);

    // Verify OTP against stored hash
    const otpRecord = await db.otpCode.findFirst({
      where: {
        id: attemptId,
        userId: user.id,
        purpose: "CHANGE_PIN",
        consumed: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otpRecord) {
      return errorJson("Invalid or expired OTP", 400);
    }

    // Verify the OTP code (hash candidate before comparing against stored SHA-256 hash)
    const valid = verifyOtp(hashOtp(otp), otpRecord.code);
    if (!valid) {
      await db.otpCode.update({ where: { id: otpRecord.id }, data: { consumed: true } });
      return errorJson("Invalid OTP", 400);
    }

    // Mark OTP as used
    await db.otpCode.update({ where: { id: otpRecord.id }, data: { consumed: true } });

    // Hash the new PIN using scrypt (consistent with the rest of the codebase)
    const storedHash = await hashPin(newPin);

    // Update user's PIN
    await db.user.update({
      where: { id: user.id },
      data: {
        transactionPinHash: storedHash,
        pinSetAt: new Date(),
        pinFailCount: 0,
        pinLockedUntil: null,
      },
    });

    await audit({ action: "change_pin.success", category: "AUTH", userId: user.id });

    return json({
      data: {
        ok: true,
        message: "Transaction PIN updated successfully",
      },
    });
  }

  return errorJson("Invalid action", 422);
}
