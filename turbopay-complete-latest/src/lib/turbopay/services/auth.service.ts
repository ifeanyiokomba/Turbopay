/**
 * Turbopay Service Layer — AuthService.
 * =======================================
 *
 * User authentication: login, register, and session management.
 * Extracted from:
 *   - src/app/api/auth/login/route.ts   → login (227 lines)
 *   - src/app/api/auth/register/route.ts → register (225 lines)
 *
 * The route handlers become thin wrappers that handle HTTP concerns
 * (parsing, rate limiting, cookies) and delegate all business logic here.
 */

import { db } from "@/lib/db";
import { createSession, readIp } from "@/lib/turbopay/auth";
import { hashPassword, verifyPassword, dummyHash, generateOtp, hashOtp } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { audit } from "@/lib/turbopay/audit";
import { isPasswordBreached } from "@/lib/turbopay/breach-check";
import { referrals } from "@/lib/turbocore/referrals";
import { normalizePhone } from "@/lib/turbocore/config/country-currency";
import { registerDevice, recordSecurityEvent } from "@/lib/turbocore/security";
import { extractDeviceInfo } from "@/lib/turbopay/device-info";
import { notify } from "@/lib/turbocore/notifications";
import { ServiceError } from "./types";
import type { SessionUser } from "@/lib/turbopay/types";
import crypto from "crypto";

// ─── Constants ──────────────────────────────────────────────────────────

const LOGIN_LOCK_THRESHOLD = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

// ─── Types ──────────────────────────────────────────────────────────────

export interface LoginInput {
  identifier: string;
  password: string;
  ip?: string;
  userAgent?: string;
}

export interface LoginResult {
  user: {
    id: string;
    fullName: string;
    username: string | null;
    kycTier: number;
    kycStatus: string;
    status: string;
    emailVerified: boolean;
    phoneVerified: boolean;
    role: string;
    hasTransactionPin: boolean;
    authProvider: string;
    createdAt: string;
  };
  mfaRequired?: boolean;
  hasBackupCodes?: boolean;
}

export interface RegisterInput {
  fullName: string;
  username?: string;
  email?: string;
  phone?: string;
  country: string;
  password: string;
  referralCode?: string;
  verifyChannel: "EMAIL" | "SMS" | "WHATSAPP";
  ip?: string;
  userAgent?: string;
}

export interface RegisterResult {
  user: {
    id: string;
    fullName: string;
    username: string | null;
    kycTier: number;
    kycStatus: string;
    status: string;
    emailVerified: boolean;
    phoneVerified: boolean;
    role: string;
    hasTransactionPin: boolean;
    authProvider: string;
    createdAt: string;
  };
}

// ─── Service ────────────────────────────────────────────────────────────

class AuthService {
  /**
   * User login with multi-factor authentication support.
   *
   * Security features:
   * - Per-IP rate limiting (10/min)
   * - Per-identifier rate limiting (10/15min)
   * - Per-user lockout (5 failures → 15min lock)
   * - Timing-safe password verification (dummyHash for unknown users)
   * - MFA gate (TOTP challenge before session creation)
   * - Device tracking + security events
   */
  async login(input: LoginInput): Promise<LoginResult & { sessionToken: string; refreshToken: string }> {
    const { identifier, password, ip, userAgent } = input;
    const id = identifier.trim().toLowerCase();

    // Look up user by email, phone, or username
    const user = await db.user.findFirst({
      where: { OR: [{ email: id }, { phone: identifier.trim() }, { username: id }] },
    });

    // Enforce per-user lockout
    if (user?.loginLockedUntil && user.loginLockedUntil > new Date()) {
      throw new ServiceError("ACCOUNT_LOCKED", "Account temporarily locked due to too many failed login attempts.", 423);
    }

    // Timing-safe password verification
    const storedHash = user?.passwordHash ?? dummyHash();
    const ok = verifyPassword(password, storedHash);

    // Log login attempt
    await db.loginHistory.create({
      data: {
        userId: user?.id ?? null,
        identifier: id,
        success: !!(user && ok),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
        errorMessage: (!user || !ok) ? "INVALID_CREDENTIALS" : null,
      },
    }).catch(() => null);

    if (!user || !ok) {
      if (user) {
        const newCount = (user.loginFailCount ?? 0) + 1;
        const locked = newCount >= LOGIN_LOCK_THRESHOLD;
        await db.user.update({
          where: { id: user.id },
          data: {
            loginFailCount: newCount,
            ...(locked ? { loginLockedUntil: new Date(Date.now() + LOGIN_LOCK_DURATION_MS) } : {}),
          },
        }).catch(() => null);
        await audit({
          userId: user.id,
          action: "LOGIN_FAILED",
          category: "AUTH",
          severity: locked ? "WARN" : "INFO",
          ip, userAgent,
          metadata: { failCount: newCount, locked },
        }).catch(() => null);
      }
      throw new ServiceError("INVALID_CREDENTIALS", "Invalid credentials", 401);
    }

    if (user.status !== "ACTIVE") {
      throw new ServiceError("ACCOUNT_NOT_ACTIVE", "Your account is not active. Please contact support.", 403);
    }

    if (!user.emailVerified) {
      throw new ServiceError("EMAIL_NOT_VERIFIED", "Please verify your email before signing in.", 403);
    }

    // Reset failure counter on success
    if (user.loginFailCount > 0 || user.loginLockedUntil) {
      await db.user.update({
        where: { id: user.id },
        data: { loginFailCount: 0, loginLockedUntil: null },
      }).catch(() => null);
    }

    // MFA gate
    if (user.mfaEnabled) {
      await audit({
        userId: user.id,
        action: "LOGIN_MFA_CHALLENGE",
        category: "AUTH",
        ip, userAgent,
      }).catch(() => null);
      return {
        user: this.formatUser(user),
        mfaRequired: true,
        hasBackupCodes: !!user.mfaBackupCodesEnc,
        sessionToken: "",
        refreshToken: "",
      };
    }

    // Create session
    const { sessionToken, refreshToken } = await createSession(user.id, { ip, userAgent });

    // Update device info
    const deviceInfo = userAgent ? extractDeviceInfo(userAgent) : null;
    await db.session.updateMany({
      where: { userId: user.id, revokedAt: null, ip: ip ?? null },
      data: { deviceInfo },
    }).catch(() => null);

    await audit({ userId: user.id, action: "USER_LOGIN", category: "AUTH", ip, userAgent });

    // Register device (best-effort)
    if (userAgent) {
      try {
        await registerDevice(user.id, userAgent, ip ?? null);
        await recordSecurityEvent(user.id, "LOGIN_SUCCESS", { ip, userAgent: userAgent });
      } catch { /* device tracking is best-effort */ }
    }

    return {
      user: this.formatUser(user),
      sessionToken,
      refreshToken,
    };
  }

  /**
   * User registration with breach check and referral support.
   */
  async register(input: RegisterInput): Promise<RegisterResult & { sessionToken: string; refreshToken: string }> {
    const { fullName, username, email, phone, country, password, referralCode, verifyChannel, ip, userAgent } = input;

    // Breach check (soft — fails open)
    try {
      const breached = await isPasswordBreached(password);
      if (breached) {
        throw new ServiceError("BREACHED_PASSWORD", "This password has been found in known data breaches. Please choose a different password.", 422);
      }
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      // Fail open — don't block registration on HIBP outage
    }

    // Uniqueness check (generic message to prevent enumeration)
    const orClauses: any[] = [];
    if (email) orClauses.push({ email: email.toLowerCase() });
    if (phone) orClauses.push({ phone });
    if (username) orClauses.push({ username: username.toLowerCase() });
    if (orClauses.length > 0) {
      const exists = await db.user.findFirst({ where: { OR: orClauses } });
      if (exists) {
        throw new ServiceError("DUPLICATE_DETAILS", "An account with these details already exists.", 409);
      }
    }

    const effectiveChannel = !email ? "SMS" : !phone ? "EMAIL" : verifyChannel;
    const normalizedPhone = phone ? normalizePhone(phone, country) : null;

    // Create user
    const user = await db.user.create({
      data: {
        fullName,
        username: username ? username.toLowerCase() : null,
        email: email ? email.toLowerCase() : null,
        country: country.toUpperCase(),
        phone: normalizedPhone,
        passwordHash: hashPassword(password),
        kycTier: 1,
        kycStatus: "UNVERIFIED",
        emailVerified: !email,
        phoneVerified: false,
        role: "USER",
        privacyPolicyAccepted: true,
        privacyPolicyAcceptedAt: new Date(),
      },
    });

    await ensureWallet(user.id, `${fullName} - Turbopay`, country.toUpperCase());

    // Best-effort referral completion
    if (referralCode && referralCode.trim().length > 0) {
      try {
        await referrals.completeReferral(referralCode.trim().toUpperCase(), user.id);
      } catch (err: any) {
        console.error("[referrals] completeReferral failed", { referredUserId: user.id, referralCode, error: err?.message ?? err });
      }
    }

    // Create session
    const { sessionToken, refreshToken } = await createSession(user.id, { ip, userAgent });
    await audit({ userId: user.id, action: "USER_REGISTERED", category: "AUTH", ip, userAgent });

    // Send verification OTP (best-effort)
    this.sendVerificationOtp(user.id, effectiveChannel, email, phone, fullName).catch(() => null);

    return {
      user: this.formatUser(user),
      sessionToken,
      refreshToken,
    };
  }

  /**
   * Format user for API response (PII minimization).
   */
  private formatUser(user: any) {
    return {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      kycTier: user.kycTier,
      kycStatus: user.kycStatus,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      role: user.role,
      hasTransactionPin: !!user.transactionPinHash,
      authProvider: user.googleId ? "google" : "password",
      createdAt: user.createdAt.toISOString(),
    };
  }

  /**
   * Send verification OTP via the chosen channel (best-effort).
   */
  private async sendVerificationOtp(
    userId: string,
    channel: string,
    email: string | undefined,
    phone: string | undefined,
    fullName: string,
  ) {
    const purpose = channel === "SMS" ? "PHONE_VERIFY" : "EMAIL_VERIFY";
    await db.otpCode.deleteMany({ where: { userId, purpose } });
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const target = channel === "SMS" ? phone : email;
    if (!target) return;

    const verificationToken = crypto.randomBytes(32).toString("hex");
    await db.otpCode.create({
      data: {
        userId,
        channel,
        target,
        code: hashOtp(code),
        purpose,
        expiresAt,
        verificationToken,
      },
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const verifyUrl = channel === "EMAIL"
      ? `${baseUrl}/api/auth/verify-email/confirm?token=${verificationToken}&target=${encodeURIComponent(target)}`
      : undefined;

    await notify.send({
      to: target,
      channel: channel === "WHATSAPP" ? "SMS" : channel as "EMAIL" | "SMS",
      template: "auth.verify-email",
      variables: {
        otp: code,
        userName: fullName.split(" ")[0],
        ...(verifyUrl ? { verifyUrl } : {}),
      },
    });

    if (process.env.NODE_ENV !== "production") {
      console.info(`[register] OTP for ${target}: ${code} (dev only)`);
    }
  }
}

export const authService = new AuthService();
