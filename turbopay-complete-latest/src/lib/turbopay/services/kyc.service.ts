/**
 * Turbopay Service Layer — KycService.
 * =====================================
 *
 * KYC status read + Tier 2 (NIN) and Tier 3 (BVN) verification. Both verify
 * paths call the Dojah adapter via the TurboCore provider registry, persist
 * a KycVerification row, update the User row with verified provider data,
 * audit the verification, fire an in-app notification, and best-effort award
 * a tier-upgrade bonus via the rewards engine.
 *
 * Extracted from:
 *   - src/app/api/kyc/route.ts GET  → getStatus
 *   - src/app/api/kyc/route.ts POST (tier=2) → verifyNin
 *   - src/app/api/kyc/route.ts POST (tier=3) → verifyBvn
 */

import { db } from "@/lib/db";
import { providers } from "@/lib/turbocore/providers/registry";
import { rewards } from "@/lib/turbocore/rewards";
import { notify } from "@/lib/turbocore/notifications";
import { audit } from "@/lib/turbopay/audit";
import { KYC_LIMITS } from "@/lib/turbopay/types";
import { encryptPii } from "@/lib/turbopay/crypto";
import { screenAndAct } from "@/lib/turbocore/compliance/screening";
import { ServiceError } from "./types";
import { logger } from "@/lib/turbocore/logger";
import type { GetKycStatusResult, VerifyNinResult, VerifyBvnResult } from "./types";

class KycService {
  async getStatus(userId: string, kycTier: number, kycStatus: string): Promise<GetKycStatusResult> {
    const record = await db.kycVerification.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return {
      tier: kycTier,
      status: kycStatus,
      record: record
        ? {
            tier: record.tier,
            status: record.status,
            provider: record.provider,
            verifiedAt: record.verifiedAt?.toISOString() ?? null,
            firstName: record.firstName,
            lastName: record.lastName,
          }
        : null,
      limits: KYC_LIMITS[kycTier as 1 | 2 | 3],
      allLimits: KYC_LIMITS,
    };
  }

  async verifyNin(
    userId: string,
    nin: string,
    phone: string | null,
    ip?: string,
  ): Promise<VerifyNinResult> {
    const kyc = await providers.kyc();
    const providerName = kyc.name.replace("mock-", "").replace("production-", "");

    const ninResult = await kyc.verifyNin(nin);
    if (!ninResult.ok || !ninResult.data) {
      throw new ServiceError("PROVIDER_ERROR", "NIN verification service unavailable", 502);
    }
    const result = ninResult.data;

    if (!result.verified) {
      await db.kycVerification.create({
        data: {
          userId,
          tier: 2,
          status: "REJECTED",
          provider: providerName,
          nin: encryptPii(nin),
          payload: JSON.stringify(result),
        },
      });
      notify
        .sendInApp({
          userId,
          type: "KYC",
          title: "KYC Rejected",
          message: "NIN verification failed. Please check your NIN and try again.",
          priority: "HIGH",
          actionUrl: "/kyc",
          actionLabel: "Retry",
        })
        .catch(() => null);
      throw new ServiceError(
        "KYC_REJECTED",
        "NIN verification failed. Please check your NIN and try again.",
        422,
      );
    }

    const verifiedFullName = `${result.firstName} ${result.lastName}`;
    await db.kycVerification.create({
      data: {
        userId,
        tier: 2,
        status: "VERIFIED",
        provider: providerName,
        nin: encryptPii(nin),
        phone,
        firstName: result.firstName,
        lastName: result.lastName,
        middleName: result.middleName,
        dob: result.dob,
        gender: result.gender,
        payload: JSON.stringify(result),
        verifiedAt: new Date(),
      },
    });
    await db.user.update({
      where: { id: userId },
      data: {
        kycTier: 2,
        kycStatus: "VERIFIED",
        nin: encryptPii(nin),
        fullName: verifiedFullName,
        dateOfBirth: result.dob,
        gender: result.gender,
        stateOfOrigin: result.stateOfOrigin ?? null,
        lga: result.lga ?? null,
        town: result.town ?? null,
      },
    });

    // Sanctions screening — check verified name against sanctions lists.
    // Runs async (fire-and-forget) so KYC is not blocked by screening latency.
    // If HIGH risk, screenAndAct freezes the wallet and opens a compliance case.
    screenAndAct(userId, verifiedFullName, { nationality: result.stateOfOrigin }).catch((err) => {
      logger.error("kyc.sanctions_screening_failed", { userId, error: err?.message ?? String(err) });
    });

    await audit({
      userId,
      action: "KYC_TIER_2_VERIFIED",
      category: "KYC",
      ip,
      metadata: {
        providerRef: result.providerRef,
        verifiedName: verifiedFullName,
        state: result.stateOfOrigin,
        lga: result.lga,
      },
    });

    notify
      .sendInApp({
        userId,
        type: "KYC",
        title: "KYC Verified",
        message: "Your NIN has been verified. Tier 2 unlocked.",
        priority: "HIGH",
        actionUrl: "/kyc",
        actionLabel: "View limits",
      })
      .catch(() => null);

    rewards
      .awardTierReward({ userId, tier: 2 })
      .catch((err) => {
        logger.error("kyc.tier_bonus_failed", { userId, tier: 2, error: err?.message ?? String(err) });
      });

    return {
      ok: true,
      tier: 2,
      name: verifiedFullName,
      verifiedData: {
        dateOfBirth: result.dob,
        gender: result.gender,
        stateOfOrigin: result.stateOfOrigin,
        lga: result.lga,
        town: result.town,
      },
    };
  }

  async verifyBvn(
    userId: string,
    currentTier: number,
    bvn: string,
    phone: string | null,
    ip?: string,
  ): Promise<VerifyBvnResult> {
    if (currentTier < 2) {
      throw new ServiceError("TIER_ORDER", "Complete Tier 2 (NIN) verification first", 400);
    }

    const kyc = await providers.kyc();
    const providerName = kyc.name.replace("mock-", "").replace("production-", "");

    const bvnResult = await kyc.verifyBvn(bvn, phone ?? "");
    if (!bvnResult.ok || !bvnResult.data) {
      throw new ServiceError("PROVIDER_ERROR", "BVN verification service unavailable", 502);
    }
    const result = bvnResult.data;

    if (!result.verified || !result.phoneMatch) {
      await db.kycVerification.create({
        data: {
          userId,
          tier: 3,
          status: "REJECTED",
          provider: providerName,
          bvn: encryptPii(bvn),
          payload: JSON.stringify(result),
        },
      });
      notify
        .sendInApp({
          userId,
          type: "KYC",
          title: "KYC Rejected",
          message: "BVN verification failed or phone number does not match.",
          priority: "HIGH",
          actionUrl: "/kyc",
          actionLabel: "Retry",
        })
        .catch(() => null);
      throw new ServiceError(
        "KYC_REJECTED",
        "BVN verification failed or phone number does not match.",
        422,
      );
    }

    const verifiedFullName = `${result.firstName} ${result.lastName}`;
    await db.kycVerification.create({
      data: {
        userId,
        tier: 3,
        status: "VERIFIED",
        provider: providerName,
        bvn: encryptPii(bvn),
        phone,
        firstName: result.firstName,
        lastName: result.lastName,
        middleName: result.middleName,
        dob: result.dob,
        gender: result.gender,
        payload: JSON.stringify(result),
        verifiedAt: new Date(),
      },
    });
    await db.user.update({
      where: { id: userId },
      data: {
        kycTier: 3,
        kycStatus: "VERIFIED",
        bvn: encryptPii(bvn),
        fullName: verifiedFullName,
        dateOfBirth: result.dob,
        gender: result.gender,
        stateOfOrigin: result.stateOfOrigin ?? null,
        lga: result.lga ?? null,
        town: result.town ?? null,
      },
    });
    await audit({
      userId,
      action: "KYC_TIER_3_VERIFIED",
      category: "KYC",
      ip,
      metadata: {
        providerRef: result.providerRef,
        verifiedName: verifiedFullName,
        state: result.stateOfOrigin,
        lga: result.lga,
      },
    });

    notify
      .sendInApp({
        userId,
        type: "KYC",
        title: "KYC Verified",
        message: "Your BVN has been verified. Tier 3 unlocked.",
        priority: "HIGH",
        actionUrl: "/kyc",
        actionLabel: "View limits",
      })
      .catch(() => null);

    rewards
      .awardTierReward({ userId, tier: 3 })
      .catch((err) => {
        logger.error("kyc.tier_bonus_failed", { userId, tier: 3, error: err?.message ?? String(err) });
      });

    return {
      ok: true,
      tier: 3,
      name: verifiedFullName,
      verifiedData: {
        dateOfBirth: result.dob,
        gender: result.gender,
        stateOfOrigin: result.stateOfOrigin,
        lga: result.lga,
        town: result.town,
      },
    };
  }

  /**
   * Generic identity verification — used by Paystack Identity (NG/GH) and
   * Stripe Identity (rest of world). Routes to the correct provider based
   * on the user's country.
   *
   * On success: upgrades user to Tier 2 (one-step for non-NG/GH users),
   * persists KycVerification, updates User with verified data, audits,
   * notifies, and awards tier bonus.
   */
  async verifyIdentity(
    userId: string,
    country: string,
    input: { documentType: string; documentValue: string; phone?: string },
    ip?: string,
  ): Promise<{ ok: true; tier: number; name: string }> {
    const kyc = await providers.kyc();
    const providerName = kyc.name.replace("mock-", "").replace("production-", "");

    const result = await kyc.verifyIdentity({
      country,
      documentType: input.documentType,
      documentValue: input.documentValue,
      phone: input.phone,
    });

    if (!result.ok || !result.data) {
      throw new ServiceError("PROVIDER_ERROR", "Identity verification service unavailable", 502);
    }

    const data = result.data;

    if (!data.verified) {
      await db.kycVerification.create({
        data: {
          userId,
          tier: 2,
          status: "REJECTED",
          provider: providerName,
          payload: JSON.stringify(data),
        },
      });
      notify
        .sendInApp({
          userId,
          type: "KYC",
          title: "KYC Rejected",
          message: "Identity verification failed. Please check your documents and try again.",
          priority: "HIGH",
          actionUrl: "/kyc",
          actionLabel: "Retry",
        })
        .catch(() => null);
      throw new ServiceError(
        "KYC_REJECTED",
        "Identity verification failed. Please check your documents and try again.",
        422,
      );
    }

    const verifiedFullName = `${data.firstName} ${data.lastName}`;
    await db.kycVerification.create({
      data: {
        userId,
        tier: 2,
        status: "VERIFIED",
        provider: providerName,
        phone: input.phone,
        firstName: data.firstName,
        lastName: data.lastName,
        middleName: data.middleName,
        dob: data.dob,
        gender: data.gender,
        payload: JSON.stringify(data),
        verifiedAt: new Date(),
      },
    });

    await db.user.update({
      where: { id: userId },
      data: {
        kycTier: 2,
        kycStatus: "VERIFIED",
        fullName: verifiedFullName,
        dateOfBirth: data.dob,
        gender: data.gender,
      },
    });

    // Sanctions screening for identity verification path.
    screenAndAct(userId, verifiedFullName, { nationality: data.address?.country }).catch((err) => {
      logger.error("kyc.sanctions_screening_failed", { userId, error: err?.message ?? String(err) });
    });

    await audit({
      userId,
      action: "KYC_TIER_2_VERIFIED",
      category: "KYC",
      ip,
      metadata: {
        providerRef: data.providerRef,
        verifiedName: verifiedFullName,
        documentType: input.documentType,
        country,
      },
    });

    notify
      .sendInApp({
        userId,
        type: "KYC",
        title: "KYC Verified",
        message: "Your identity has been verified. Tier 2 unlocked.",
        priority: "HIGH",
        actionUrl: "/kyc",
        actionLabel: "View limits",
      })
      .catch(() => null);

    rewards
      .awardTierReward({ userId, tier: 2 })
      .catch((err) => {
        logger.error("kyc.tier_bonus_failed", { userId, tier: 2, error: err?.message ?? String(err) });
      });

    return {
      ok: true,
      tier: 2,
      name: verifiedFullName,
    };
  }
}

export const kycService = new KycService();
