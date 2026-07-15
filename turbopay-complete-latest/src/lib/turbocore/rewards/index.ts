/**
 * TurboCore — Rewards Engine
 * ==========================
 *
 * Complements (does NOT replace) the referrals and vouchers services:
 *  - referrals/  credits the referrer's wallet on a completed referral.
 *  - vouchers/   records a VoucherRedemption + tracks campaign budget.
 *  - rewards/   (this file) accrues CASHBACK on eligible transactions and
 *               awards one-time TIER_BONUS bonuses when a user upgrades KYC.
 *
 * Every award:
 *  1. Is idempotent (per sourceTransactionId+type for cashback; per
 *     userId+tier for tier bonus).
 *  2. Writes a UserReward row (the audit trail of "what the user earned").
 *  3. Credits the wallet via `creditWallet` (the ledger — source of truth).
 *  4. Writes an AuditLog entry.
 *
 * Money is always Int kobo (minor units). No `any`.
 */

import { db } from "@/lib/db";
import { creditWallet } from "@/lib/turbopay/ledger";
import { audit } from "@/lib/turbopay/audit";
import type { RefType } from "@/lib/turbopay/types";

// ─── Configurable constants ────────────────────────────────────────────

/**
 * One-time tier-upgrade bonus, in kobo, by KYC tier.
 * Awarded the first time a user reaches a given tier (idempotent per tier).
 * Override by editing this map (a future RewardRule table can drive this
 * dynamically; for now the constant is the source of truth).
 */
export const TIER_BONUS_KOBO: Readonly<Record<number, number>> = Object.freeze({
  2: 500_00, // ₦500 for Tier 2 (NIN)
  3: 2_000_00, // ₦2,000 for Tier 3 (BVN)
});

/**
 * Default cashback rates, in basis points (1 bps = 0.01%). 50 bps = 0.5%.
 * Used when no explicit RewardRule is provided. Override per-transaction by
 * passing `ruleId` (future: lookup against a RewardRule table).
 */
export const DEFAULT_CASHBACK_BPS: Readonly<Record<string, number>> = Object.freeze({
  AIRTIME: 50, // 0.5%
  DATA: 50, // 0.5%
  BILL_ELECTRICITY: 100, // 1%
  BILL_UTILITY: 100, // 1%
  TRANSFER_OUT: 0, // no cashback on transfers
  TRANSFER_IN: 0,
  FUNDING: 0,
  FEE: 0,
  REVERSAL: 0,
});

// ─── Types ─────────────────────────────────────────────────────────────

export type RewardType = "CASHBACK" | "TIER_BONUS" | "CAMPAIGN_REWARD" | "REFERRAL_BONUS" | "VOUCHER";

export interface AwardCashbackInput {
  userId: string;
  transactionId: string;
  /** Transaction amount in kobo (minor units). */
  amountMinor: number;
  /** TxType category — AIRTIME | DATA | BILL_ELECTRICITY | BILL_UTILITY | TRANSFER_OUT | … */
  category: string;
  /** Optional rule id (for future RewardRule-driven rates). */
  ruleId?: string;
}

export interface AwardTierRewardInput {
  userId: string;
  tier: 2 | 3;
}

export interface CashbackResult {
  awarded: boolean;
  rewardId: string | null;
  cashbackKobo: number;
  reason?: string;
}

export interface TierRewardResult {
  awarded: boolean;
  rewardId: string | null;
  bonusKobo: number;
  reason?: string;
}

export interface RewardSummary {
  totalCashbackKobo: number;
  totalTierBonusKobo: number;
  totalCampaignRewardKobo: number;
  totalReferralBonusKobo: number;
  totalVoucherKobo: number;
  count: number;
}

// ─── Service ───────────────────────────────────────────────────────────

class RewardsService {
  /**
   * Award cashback on a completed transaction.
   * Idempotent: if a CASHBACK UserReward with the same sourceTransactionId
   * already exists, the call is a no-op and returns { awarded: false }.
   */
  async awardCashback(input: AwardCashbackInput): Promise<CashbackResult> {
    if (input.amountMinor <= 0) return { awarded: false, rewardId: null, cashbackKobo: 0, reason: "AMOUNT_NON_POSITIVE" };

    // Idempotency: skip if a CASHBACK reward already exists for this transaction.
    const existing = await db.userReward.findFirst({
      where: { type: "CASHBACK", sourceTransactionId: input.transactionId },
      select: { id: true, valueKobo: true },
    });
    if (existing) return { awarded: false, rewardId: existing.id, cashbackKobo: existing.valueKobo, reason: "ALREADY_AWARDED" };

    const bps = DEFAULT_CASHBACK_BPS[input.category] ?? 0;
    const cashbackKobo = Math.floor((input.amountMinor * bps) / 10_000);
    if (cashbackKobo <= 0) {
      // Still record the reward row (zero-value) so the audit trail is complete
      // and the idempotency check above will skip future calls.
      const reward = await db.userReward.create({
        data: {
          userId: input.userId,
          type: "CASHBACK",
          title: `${input.category} cashback`,
          description: `${bps} bps cashback on transaction ${input.transactionId}`,
          valueKobo: 0,
          status: "AVAILABLE",
          sourceTransactionId: input.transactionId,
          ruleId: input.ruleId ?? null,
          metadata: JSON.stringify({ category: input.category, bps, amountMinor: input.amountMinor }),
        },
      });
      await audit({ userId: input.userId, action: "CASHBACK_AWARDED_ZERO", category: "WALLET", metadata: { rewardId: reward.id, transactionId: input.transactionId, category: input.category } });
      return { awarded: false, rewardId: reward.id, cashbackKobo: 0, reason: "ZERO_RATE" };
    }

    const wallet = await db.wallet.findUnique({ where: { userId: input.userId }, select: { id: true } });
    if (!wallet) throw new Error("WALLET_NOT_FOUND");

    // Credit the wallet via the ledger (source of truth).
    const refType: RefType = "REWARD_CASHBACK";
    const credit = await creditWallet(wallet.id, cashbackKobo, refType, {
      refId: input.transactionId,
      description: `Cashback: ${input.category} (₦${(cashbackKobo / 100).toFixed(2)})`,
    });

    const reward = await db.userReward.create({
      data: {
        userId: input.userId,
        type: "CASHBACK",
        title: `${input.category} cashback`,
        description: `${bps} bps cashback on transaction ${input.transactionId}`,
        valueKobo: cashbackKobo,
        status: "AVAILABLE",
        sourceTransactionId: input.transactionId,
        ruleId: input.ruleId ?? null,
        metadata: JSON.stringify({
          category: input.category, bps, amountMinor: input.amountMinor,
          ledgerEntryId: credit.ledgerEntryId, balanceAfterKobo: credit.balanceAfterKobo,
        }),
      },
    });

    await audit({
      userId: input.userId,
      action: "CASHBACK_AWARDED",
      category: "WALLET",
      metadata: { rewardId: reward.id, transactionId: input.transactionId, cashbackKobo, category: input.category, bps },
    });

    return { awarded: true, rewardId: reward.id, cashbackKobo };
  }

  /**
   * Award a one-time bonus when a user upgrades to a higher KYC tier.
   * Idempotent: if a TIER_BONUS UserReward with the same (userId, tier)
   * already exists, the call is a no-op.
   */
  async awardTierReward(input: AwardTierRewardInput): Promise<TierRewardResult> {
    const bonusKobo = TIER_BONUS_KOBO[input.tier] ?? 0;
    if (bonusKobo <= 0) return { awarded: false, rewardId: null, bonusKobo: 0, reason: "NO_BONUS_FOR_TIER" };

    // Idempotency: skip if a TIER_BONUS reward already exists for this user+tier.
    const existing = await db.userReward.findFirst({
      where: { userId: input.userId, type: "TIER_BONUS", tier: input.tier },
      select: { id: true, valueKobo: true },
    });
    if (existing) return { awarded: false, rewardId: existing.id, bonusKobo: existing.valueKobo, reason: "ALREADY_AWARDED" };

    const wallet = await db.wallet.findUnique({ where: { userId: input.userId }, select: { id: true } });
    if (!wallet) throw new Error("WALLET_NOT_FOUND");

    const refType: RefType = "REWARD_BONUS";
    const credit = await creditWallet(wallet.id, bonusKobo, refType, {
      description: `Tier ${input.tier} upgrade bonus`,
    });

    const reward = await db.userReward.create({
      data: {
        userId: input.userId,
        type: "TIER_BONUS",
        title: `Tier ${input.tier} upgrade bonus`,
        description: `One-time bonus for upgrading to KYC Tier ${input.tier}`,
        valueKobo: bonusKobo,
        status: "AVAILABLE",
        tier: input.tier,
        metadata: JSON.stringify({ tier: input.tier, ledgerEntryId: credit.ledgerEntryId, balanceAfterKobo: credit.balanceAfterKobo }),
      },
    });

    await audit({
      userId: input.userId,
      action: "TIER_BONUS_AWARDED",
      category: "WALLET",
      severity: "INFO",
      metadata: { rewardId: reward.id, tier: input.tier, bonusKobo },
    });

    return { awarded: true, rewardId: reward.id, bonusKobo };
  }

  /** List a user's rewards (newest first), optionally filtered by type. */
  async getCampaignRewards(userId: string, opts?: { type?: RewardType }): Promise<Array<{
    id: string; type: string; title: string; description: string | null;
    valueKobo: number; status: string; tier: number | null;
    sourceTransactionId: string | null; createdAt: Date;
  }>> {
    return db.userReward.findMany({
      where: opts?.type ? { userId, type: opts.type } : { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, type: true, title: true, description: true,
        valueKobo: true, status: true, tier: true,
        sourceTransactionId: true, createdAt: true,
      },
    });
  }

  /** Aggregate summary of all rewards earned by a user. */
  async getSummary(userId: string): Promise<RewardSummary> {
    const rows = await db.userReward.findMany({
      where: { userId },
      select: { type: true, valueKobo: true },
    });
    const sum = (t: string) => rows.filter((r) => r.type === t).reduce((a, r) => a + r.valueKobo, 0);
    return {
      totalCashbackKobo: sum("CASHBACK"),
      totalTierBonusKobo: sum("TIER_BONUS"),
      totalCampaignRewardKobo: sum("CAMPAIGN_REWARD"),
      totalReferralBonusKobo: sum("REFERRAL_BONUS"),
      totalVoucherKobo: sum("VOUCHER"),
      count: rows.length,
    };
  }
}

export const rewards = new RewardsService();
