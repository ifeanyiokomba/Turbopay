import { db } from "@/lib/db";
import { generateOtp, hashOtp } from "@/lib/turbopay/crypto";
import { verifyOtp } from "@/lib/turbopay/otp-verify";
import { audit } from "@/lib/turbopay/audit";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";

const RECOVERY_TYPES = [
  "FORGOT_PASSWORD", "FORGOT_USERNAME", "FORGOT_PIN", "FORGOT_PHONE", "FORGOT_EMAIL",
  "ACCOUNT_LOCKED", "LOST_DEVICE", "SUSPICIOUS_LOGIN", "RECOVER_DEACTIVATED",
] as const;

class RecoveryService {
  /** Initiate a recovery attempt — logs the attempt + sends OTP if user found. */
  async initiate(input: { identifier: string; recoveryType: string; ip?: string; userAgent?: string }) {
    const id = input.identifier.trim().toLowerCase();
    const user = await db.user.findFirst({ where: { OR: [{ email: id }, { phone: input.identifier.trim() }, { username: id }] } });

    // Create recovery attempt record (always — even if user not found, for audit).
    const attempt = await db.recoveryAttempt.create({
      data: {
        userId: user?.id ?? null,
        identifier: id,
        recoveryType: input.recoveryType,
        status: user ? "OTP_SENT" : "FAILED",
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: user ? JSON.stringify({ maskedEmail: maskEmail(user.email), maskedPhone: user.phone ? maskPhone(user.phone) : null }) : null,
      },
    });

    if (!user) {
      await audit({ action: "RECOVERY_FAILED_USER_NOT_FOUND", category: "AUTH", severity: "WARN", metadata: { recoveryType: input.recoveryType, identifier: id } });
      return { attemptId: attempt.id, otpSent: false, reason: "USER_NOT_FOUND" };
    }

    // Send OTP via the most appropriate verified channel.
    const otp = generateOtp();
    const channel = user.emailVerified ? "EMAIL" : "PHONE";
    const target = (channel === "EMAIL" ? user.email : (user.phone ?? user.email)) as string;

    await db.recoveryToken.create({
      data: {
        userId: user.id,
        channel,
        target,
        code: hashOtp(otp),
        purpose: input.recoveryType,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    await audit({ userId: user.id, action: "RECOVERY_INITIATED", category: "AUTH", severity: "WARN", metadata: { recoveryType: input.recoveryType, attemptId: attempt.id, channel } });

    // In dev: log OTP server-side. In prod: send via notification provider.
    // SECURITY: Never return OTPs in the response body — even in dev.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[recovery] OTP for ${target}: ${otp} (dev only)`);
    }
    return { attemptId: attempt.id, otpSent: true, channel, maskedTarget: channel === "EMAIL" ? maskEmail(target) : maskPhone(target) };
  }

  /** Verify the OTP for a recovery attempt. */
  async verifyOtp(input: { attemptId: string; otp: string }) {
    const attempt = await db.recoveryAttempt.findUnique({ where: { id: input.attemptId } });
    if (!attempt || attempt.status !== "OTP_SENT") return { verified: false, reason: "INVALID_ATTEMPT" };
    if (!attempt.userId) return { verified: false, reason: "NO_USER" };

    const token = await db.recoveryToken.findFirst({
      where: { userId: attempt.userId, purpose: attempt.recoveryType, consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!token || !verifyOtp(hashOtp(input.otp), token.code)) {
      await db.recoveryAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED" } });
      return { verified: false, reason: "INVALID_OR_EXPIRED_OTP" };
    }

    await db.recoveryToken.update({ where: { id: token.id }, data: { consumed: true } });
    await db.recoveryAttempt.update({ where: { id: attempt.id }, data: { status: "VERIFIED" } });
    await audit({ userId: attempt.userId, action: "RECOVERY_OTP_VERIFIED", category: "AUTH", metadata: { recoveryType: attempt.recoveryType, attemptId: attempt.id } });

    return { verified: true, userId: attempt.userId, recoveryType: attempt.recoveryType };
  }

  /**
   * Complete a recovery — reset password/PIN, return username, etc.
   *
   * Of the 9 recovery types in RECOVERY_TYPES, only 3 are auto-completable
   * today: FORGOT_PASSWORD, FORGOT_PIN, FORGOT_USERNAME. The remaining 6
   * (FORGOT_PHONE, FORGOT_EMAIL, ACCOUNT_LOCKED, LOST_DEVICE, SUSPICIOUS_LOGIN,
   * RECOVER_DEACTIVATED) require either out-of-band channel verification or
   * human review — this method returns an explicit reason code so the UI can
   * route the user to the right next step instead of silently no-op'ing.
   */
  async complete(input: { attemptId: string; newPassword?: string; newPin?: string }) {
    const attempt = await db.recoveryAttempt.findUnique({ where: { id: input.attemptId } });
    if (!attempt || attempt.status !== "VERIFIED" || !attempt.userId) return { completed: false, reason: "NOT_VERIFIED" };

    const { hashPassword, hashPin } = await import("@/lib/turbopay/crypto");

    const t = attempt.recoveryType;

    if (t === "FORGOT_PASSWORD") {
      if (!input.newPassword) return { completed: false, reason: "NEW_PASSWORD_REQUIRED" };
      await db.user.update({ where: { id: attempt.userId }, data: { passwordHash: hashPassword(input.newPassword) } });
      // Revoke all active sessions — force re-login on the new password.
      await db.session.updateMany({ where: { userId: attempt.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit({ userId: attempt.userId, action: "PASSWORD_RESET_VIA_RECOVERY", category: "AUTH", severity: "WARN" });
    } else if (t === "FORGOT_PIN") {
      if (!input.newPin) return { completed: false, reason: "NEW_PIN_REQUIRED" };
      await db.user.update({ where: { id: attempt.userId }, data: { transactionPinHash: hashPin(input.newPin), pinFailCount: 0, pinLockedUntil: null } });
      await audit({ userId: attempt.userId, action: "PIN_RESET_VIA_RECOVERY", category: "AUTH", severity: "WARN" });
    } else if (t === "FORGOT_USERNAME") {
      const user = await db.user.findUnique({ where: { id: attempt.userId }, select: { username: true, fullName: true } });
      await db.recoveryAttempt.update({ where: { id: attempt.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      await audit({ userId: attempt.userId, action: "USERNAME_REVEALED_VIA_RECOVERY", category: "AUTH" });
      return { completed: true, username: user?.username ?? null, fullName: user?.fullName };
    } else if (t === "FORGOT_PHONE" || t === "FORGOT_EMAIL") {
      // Changing a contact channel requires verifying the NEW channel out-of-band
      // (SMS OTP / email link) — not something this flow can do automatically.
      await audit({ userId: attempt.userId, action: "RECOVERY_REQUIRES_NEW_CONTACT", category: "AUTH", severity: "WARN", metadata: { recoveryType: t } });
      return { completed: false, reason: "REQUIRES_NEW_CONTACT_VERIFICATION" };
    } else if (t === "ACCOUNT_LOCKED" || t === "LOST_DEVICE" || t === "SUSPICIOUS_LOGIN" || t === "RECOVER_DEACTIVATED") {
      // These flows need human review (identity documents, in-person KYC, etc.).
      await audit({ userId: attempt.userId, action: "REQUIRES_SUPPORT_TICKET", category: "AUTH", severity: "WARN", metadata: { recoveryType: t } });
      return { completed: false, reason: "REQUIRES_SUPPORT_TICKET" };
    } else {
      return { completed: false, reason: "UNSUPPORTED_RECOVERY_TYPE" };
    }

    await db.recoveryAttempt.update({ where: { id: attempt.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    return { completed: true };
  }

  /** Get recovery history for a user (admin view). */
  async getUserRecoveryHistory(userId: string) {
    return db.recoveryAttempt.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  /** Get all recent recovery attempts (admin audit view). */
  async listRecent(limit = 50) {
    return db.recoveryAttempt.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  }
}

export const recovery = new RecoveryService();
export { RECOVERY_TYPES };
