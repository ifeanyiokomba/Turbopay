import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { rewards } from "@/lib/turbocore/rewards";
import { referrals } from "@/lib/turbocore/referrals";
import { nairaToKobo } from "@/lib/turbopay/money";
import { generateReference } from "@/lib/turbopay/reference";

/**
 * REWARDS + REFERRALS WIRING TEST SUITE
 *
 * Verifies the idempotency + crediting invariants of the rewards/referrals
 * engines AFTER they are wired into the transaction / KYC / register flows.
 * The engines themselves are unchanged; these tests prove the contracts the
 * route handlers depend on (best-effort, idempotent, non-double-crediting).
 *
 * Pattern: real SQLite dev DB, hermetic users/wallets created in beforeAll,
 * full teardown in afterAll. Mirrors ledger.test.ts + reconciliation.test.ts.
 */

const ts = Date.now();
let cashbackUserId: string;
let cashbackWalletId: string;
let cashbackTransactionId: string;

let tierUserId: string;
let tierWalletId: string;

let referrerId: string;
let referrerWalletId: string;
let referredId: string;
let referralCode: string;
let referralId: string;

beforeAll(async () => {
  // ─── Cashback test user ──────────────────────────────────────────────
  const cashbackUser = await db.user.create({
    data: {
      fullName: "Rewards Cashback Test",
      email: `rewards-cashback-${ts}@turbopay.test`,
      phone: `+2347400000${String(ts).slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  cashbackUserId = cashbackUser.id;
  const cashbackWallet = await ensureWallet(cashbackUser.id, "Cashback Test - Turbopay");
  cashbackWalletId = cashbackWallet.wallet.id;

  // A real Transaction row is needed so the cashback engine's
  // sourceTransactionId reference is meaningful. We mirror the columns the
  // airtime/data/bills routes populate.
  cashbackTransactionId = generateReference("TP");
  await db.transaction.create({
    data: {
      id: cashbackTransactionId,
      userId: cashbackUserId,
      walletId: cashbackWalletId,
      type: "AIRTIME",
      direction: "DEBIT",
      amountKobo: nairaToKobo(1000),
      feeKobo: 0,
      status: "SUCCESS",
      reference: cashbackTransactionId,
      description: "Test airtime purchase",
      counterpartyName: "MTN",
      counterpartyAccount: "+2348012345678",
      provider: "baxi",
      metadata: JSON.stringify({ test: "rewards-wiring" }),
    },
  });

  // ─── Tier-bonus test user ────────────────────────────────────────────
  const tierUser = await db.user.create({
    data: {
      fullName: "Rewards Tier Test",
      email: `rewards-tier-${ts}@turbopay.test`,
      phone: `+2347400001${String(ts).slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 1,
      kycStatus: "UNVERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  tierUserId = tierUser.id;
  const tierWallet = await ensureWallet(tierUser.id, "Tier Test - Turbopay");
  tierWalletId = tierWallet.wallet.id;

  // ─── Referral test users ─────────────────────────────────────────────
  const referrer = await db.user.create({
    data: {
      fullName: "Referrer Test",
      email: `referrer-${ts}@turbopay.test`,
      phone: `+2347400002${String(ts).slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  referrerId = referrer.id;
  const referrerWallet = await ensureWallet(referrerId, "Referrer - Turbopay");
  referrerWalletId = referrerWallet.wallet.id;

  const referred = await db.user.create({
    data: {
      fullName: "Referred Test",
      email: `referred-${ts}@turbopay.test`,
      phone: `+2347400003${String(ts).slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 1,
      kycStatus: "UNVERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  referredId = referred.id;

  // Manually create a PENDING referral with a positive wallet-credit reward
  // (the production code path: an admin/owner pre-configures the reward).
  referralCode = `RW${ts.toString(36).toUpperCase().slice(0, 6)}`;
  const referral = await db.referral.create({
    data: {
      referrerId,
      referralCode,
      status: "PENDING",
      rewardKobo: nairaToKobo(1000),
      rewardType: "WALLET_CREDIT",
    },
  });
  referralId = referral.id;
});

afterAll(async () => {
  // Cashback user teardown
  await db.userReward.deleteMany({ where: { userId: cashbackUserId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: cashbackWalletId } });
  await db.transaction.deleteMany({ where: { id: cashbackTransactionId } });
  await db.wallet.deleteMany({ where: { id: cashbackWalletId } });
  await db.user.deleteMany({ where: { id: cashbackUserId } });

  // Tier user teardown
  await db.userReward.deleteMany({ where: { userId: tierUserId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: tierWalletId } });
  await db.wallet.deleteMany({ where: { id: tierWalletId } });
  await db.user.deleteMany({ where: { id: tierUserId } });

  // Referral teardown
  await db.userReward.deleteMany({ where: { userId: referrerId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: referrerWalletId } });
  await db.referral.deleteMany({ where: { id: referralId } });
  await db.wallet.deleteMany({ where: { id: referrerWalletId } });
  await db.user.deleteMany({ where: { id: referrerId } });
  await db.user.deleteMany({ where: { id: referredId } });

  await db.$disconnect();
});

describe("Rewards wiring — awardCashback idempotency", () => {
  it("credits cashback on the first call for a transaction", async () => {
    // Pre-condition: wallet starts at 0.
    const before = await db.wallet.findUnique({ where: { id: cashbackWalletId } });
    expect(before!.balanceKobo).toBe(0);

    const result = await rewards.awardCashback({
      userId: cashbackUserId,
      transactionId: cashbackTransactionId,
      amountMinor: nairaToKobo(1000), // ₦1000
      category: "AIRTIME", // 50 bps = 0.5% → ₦5 = 500 kobo
    });

    expect(result.awarded).toBe(true);
    expect(result.cashbackKobo).toBe(500); // 0.5% of ₦1000
    expect(result.rewardId).toBeTruthy();

    const after = await db.wallet.findUnique({ where: { id: cashbackWalletId } });
    expect(after!.balanceKobo).toBe(500);
  });

  it("does NOT double-credit on a second call with the same transactionId", async () => {
    const result = await rewards.awardCashback({
      userId: cashbackUserId,
      transactionId: cashbackTransactionId,
      amountMinor: nairaToKobo(1000),
      category: "AIRTIME",
    });

    expect(result.awarded).toBe(false);
    expect(result.reason).toBe("ALREADY_AWARDED");
    expect(result.cashbackKobo).toBe(500);

    // Wallet balance unchanged from the first call.
    const after = await db.wallet.findUnique({ where: { id: cashbackWalletId } });
    expect(after!.balanceKobo).toBe(500);

    // Only one UserReward row exists for this transaction.
    const rows = await db.userReward.findMany({
      where: { type: "CASHBACK", sourceTransactionId: cashbackTransactionId },
    });
    expect(rows.length).toBe(1);
  });
});

describe("Rewards wiring — awardTierReward idempotency", () => {
  it("awards the Tier 2 bonus on the first call", async () => {
    const before = await db.wallet.findUnique({ where: { id: tierWalletId } });
    expect(before!.balanceKobo).toBe(0);

    const result = await rewards.awardTierReward({ userId: tierUserId, tier: 2 });

    expect(result.awarded).toBe(true);
    expect(result.bonusKobo).toBe(50_000); // ₦500 = 50,000 kobo
    expect(result.rewardId).toBeTruthy();

    const after = await db.wallet.findUnique({ where: { id: tierWalletId } });
    expect(after!.balanceKobo).toBe(50_000);
  });

  it("does NOT double-credit on a second call for the same (userId, tier)", async () => {
    const result = await rewards.awardTierReward({ userId: tierUserId, tier: 2 });

    expect(result.awarded).toBe(false);
    expect(result.reason).toBe("ALREADY_AWARDED");
    expect(result.bonusKobo).toBe(50_000);

    const after = await db.wallet.findUnique({ where: { id: tierWalletId } });
    expect(after!.balanceKobo).toBe(50_000);

    // Only one TIER_BONUS UserReward row exists for this user+tier.
    const rows = await db.userReward.findMany({
      where: { userId: tierUserId, type: "TIER_BONUS", tier: 2 },
    });
    expect(rows.length).toBe(1);
  });
});

describe("Referrals wiring — completeReferral credits the referrer", () => {
  it("credits the referrer's wallet when a PENDING referral is completed", async () => {
    const before = await db.wallet.findUnique({ where: { id: referrerWalletId } });
    expect(before!.balanceKobo).toBe(0);

    await referrals.completeReferral(referralCode, referredId);

    const after = await db.wallet.findUnique({ where: { id: referrerWalletId } });
    expect(after!.balanceKobo).toBe(nairaToKobo(1000)); // ₦1000 reward

    // The referral row is now REWARDED and linked to the referred user.
    const referral = await db.referral.findUnique({ where: { id: referralId } });
    expect(referral!.status).toBe("REWARDED");
    expect(referral!.referredId).toBe(referredId);
    expect(referral!.completedAt).toBeTruthy();
  });

  it("is a no-op when called again with the same code (already non-PENDING)", async () => {
    const before = await db.wallet.findUnique({ where: { id: referrerWalletId } });
    const balanceBefore = before!.balanceKobo;

    await referrals.completeReferral(referralCode, referredId);

    // No double-credit — the referrer's balance is unchanged.
    const after = await db.wallet.findUnique({ where: { id: referrerWalletId } });
    expect(after!.balanceKobo).toBe(balanceBefore);
  });

  it("is a no-op for an unknown code (never throws)", async () => {
    const before = await db.wallet.findUnique({ where: { id: referrerWalletId } });
    const balanceBefore = before!.balanceKobo;

    // Should not throw — the engine returns early on missing referral.
    await referrals.completeReferral("UNKNOWN_CODE_12345", referredId);

    const after = await db.wallet.findUnique({ where: { id: referrerWalletId } });
    expect(after!.balanceKobo).toBe(balanceBefore);
  });
});
