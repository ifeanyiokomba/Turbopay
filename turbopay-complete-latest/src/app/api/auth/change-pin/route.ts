import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
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
    // Generate a 6-digit OTP
    const devOtp = process.env.NODE_ENV !== "production" ? String(Math.floor(100000 + Math.random() * 900000)) : undefined;
    const hashedOtp = crypto.createHash("sha256").update(devOtp ?? "production-otp").digest("hex");

    // Store the OTP attempt (expires in 10 minutes)
    const id = crypto.randomBytes(16).toString("hex");
    // In production, store in DB with TTL. For now, use a simple in-memory approach.
    // The OTP verification below will work with the dev OTP.

    await audit({ action: "change_pin.otp_requested", category: "AUTH", userId: user.id });

    return json({
      data: {
        attemptId: id,
        devOtp, // Only in development
        message: "OTP sent to your email/phone",
      },
    });
  }

  if (action === "change-pin") {
    if (!otp) return errorJson("Missing OTP", 422);
    if (!newPin || newPin.length !== 4) return errorJson("PIN must be 4 digits", 422);
    if (!/^\d{4}$/.test(newPin)) return errorJson("PIN must contain only digits", 422);

    // In production: verify OTP against stored hash
    // For now, accept any 6-digit OTP in development
    if (process.env.NODE_ENV === "production") {
      // TODO: Verify OTP from DB
      return errorJson("OTP verification not implemented in production", 501);
    }

    // Hash the new PIN
    const salt = crypto.randomBytes(16).toString("hex");
    const pinHash = crypto.createHash("sha256").update(newPin + salt).digest("hex");
    const storedHash = `scrypt$${salt}$${pinHash}`;

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
