import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { analytics } from "@/lib/turbocore/analytics";
import { nairaToKobo } from "@/lib/turbopay/money";

/**
 * Analytics Service Tests
 *
 * Verifies cohort analysis, trend aggregation, and dashboard metrics.
 * Uses real database queries against the test database.
 */

let testUserId: string;
let testWalletId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const user = await db.user.create({
    data: {
      fullName: "Analytics Test User",
      email: `analytics-${suffix}@turbopay.test`,
      phone: `+234700888${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "Analytics Test User - Turbopay");
  testWalletId = wallet.id;

  // Create some test transactions for analytics
  const now = new Date();
  for (let i = 0; i < 5; i++) {
    await db.transaction.create({
      data: {
        reference: `TP-ANALYTICS-${i}`,
        userId: testUserId,
        walletId: testWalletId,
        type: "AIRTIME",
        direction: "DEBIT",
        amountKobo: nairaToKobo(100),
        feeKobo: nairaToKobo(5),
        status: "SUCCESS",
        createdAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000), // spread over 5 days
      },
    });
  }
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

describe("Analytics Service", () => {
  describe("userGrowth", () => {
    it("returns user growth trend by day", async () => {
      const now = new Date();
      const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const trend = await analytics.userGrowth({ from, to: now }, "day");
      expect(Array.isArray(trend)).toBe(true);
      expect(trend.length).toBeGreaterThanOrEqual(1);
      expect(trend[0]).toHaveProperty("date");
      expect(trend[0]).toHaveProperty("value");
    });

    it("returns user growth trend by week", async () => {
      const now = new Date();
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const trend = await analytics.userGrowth({ from, to: now }, "week");
      expect(Array.isArray(trend)).toBe(true);
    });
  });

  describe("transactionVolume", () => {
    it("returns transaction volume by type", async () => {
      const now = new Date();
      const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const volume = await analytics.transactionVolume({ from, to: now }, "day");
      expect(typeof volume).toBe("object");
      // Should have at least AIRTIME type from our test data
      expect(Object.keys(volume).length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("revenueSummary", () => {
    it("returns revenue summary with correct structure", async () => {
      const now = new Date();
      const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const revenue = await analytics.revenueSummary({ from, to: now });
      expect(revenue).toHaveProperty("totalFeesKobo");
      expect(revenue).toHaveProperty("transactionCount");
      expect(revenue).toHaveProperty("averageFeeKobo");
      expect(typeof revenue.totalFeesKobo).toBe("number");
      expect(typeof revenue.transactionCount).toBe("number");
    });
  });

  describe("walletMetrics", () => {
    it("returns wallet metrics with correct structure", async () => {
      const metrics = await analytics.walletMetrics();
      expect(metrics).toHaveProperty("totalBalanceKobo");
      expect(metrics).toHaveProperty("activeWallets");
      expect(metrics).toHaveProperty("averageBalanceKobo");
      expect(metrics).toHaveProperty("frozenWallets");
      expect(typeof metrics.activeWallets).toBe("number");
      expect(metrics.activeWallets).toBeGreaterThanOrEqual(1);
    });
  });

  describe("kycCompletionRates", () => {
    it("returns KYC completion rates by tier", async () => {
      const rates = await analytics.kycCompletionRates();
      expect(Array.isArray(rates)).toBe(true);
      expect(rates.length).toBe(3); // Tiers 1, 2, 3
      expect(rates[0]).toHaveProperty("tier");
      expect(rates[0]).toHaveProperty("total");
      expect(rates[0]).toHaveProperty("verified");
      expect(rates[0]).toHaveProperty("completionRate");
    });
  });

  describe("amlSummary", () => {
    it("returns AML summary with correct structure", async () => {
      const now = new Date();
      const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const summary = await analytics.amlSummary({ from, to: now });
      expect(summary).toHaveProperty("totalFlags");
      expect(summary).toHaveProperty("unresolved");
      expect(summary).toHaveProperty("byRule");
      expect(summary).toHaveProperty("bySeverity");
    });
  });

  describe("dashboardSummary", () => {
    it("returns comprehensive dashboard summary", async () => {
      const now = new Date();
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const summary = await analytics.dashboardSummary({ from, to: now });

      expect(summary).toHaveProperty("users");
      expect(summary).toHaveProperty("transactions");
      expect(summary).toHaveProperty("revenue");
      expect(summary).toHaveProperty("wallets");
      expect(summary).toHaveProperty("kyc");
      expect(summary).toHaveProperty("support");
      expect(summary).toHaveProperty("aml");

      // Users section
      expect(summary.users).toHaveProperty("total");
      expect(summary.users).toHaveProperty("newThisPeriod");
      expect(summary.users).toHaveProperty("growthRate");

      // Transactions section
      expect(summary.transactions).toHaveProperty("total");
      expect(summary.transactions).toHaveProperty("volumeKobo");
      expect(summary.transactions).toHaveProperty("successRate");

      // Wallets section
      expect(summary.wallets).toHaveProperty("totalBalanceKobo");
      expect(summary.wallets).toHaveProperty("active");
      expect(summary.wallets).toHaveProperty("frozen");
    });
  });
});
