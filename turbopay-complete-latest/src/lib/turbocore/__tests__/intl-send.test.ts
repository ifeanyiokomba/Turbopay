import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { creditWallet } from "@/lib/turbopay/ledger";
import { nairaToKobo } from "@/lib/turbopay/money";

/**
 * International Send Service Tests
 *
 * Tests the outbound international transfer business logic.
 * Uses real database but tests input validation and balance checks.
 */

let testUserId: string;
let testWalletId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const user = await db.user.create({
    data: {
      fullName: "Intl Send Test User",
      email: `intl-send-${suffix}@turbopay.test`,
      phone: `+234700999${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "Intl Send Test User - Turbopay");
  testWalletId = wallet.id;

  // Fund the wallet
  await creditWallet(testWalletId, nairaToKobo(1_000_000), "FUNDING");
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

describe("International Send Service", () => {
  describe("Input validation", () => {
    it("rejects transfers with negative amount", async () => {
      const { sendInternationalTransfer } = await import("@/lib/turbocore/international/send");
      const result = await sendInternationalTransfer({
        userId: testUserId,
        walletId: testWalletId,
        kycTier: 3,
        sourceCurrency: "NGN",
        destinationCurrency: "USD",
        amountMinor: -100,
        beneficiary: { name: "John Smith", country: "US" },
        purpose: "Test",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Insufficient funds", () => {
    it("returns error when wallet balance is too low", async () => {
      // Create a new user with low balance
      const suffix = Math.floor(Math.random() * 1_000_000).toString();
      const user2 = await db.user.create({
        data: {
          fullName: "Low Balance User",
          email: `low-balance-${suffix}@turbopay.test`,
          passwordHash: hashPassword("testpassword123"),
          kycTier: 3,
        },
      });
      const { wallet: wallet2 } = await ensureWallet(user2.id, "Low Balance User");

      // Fund only ₦500
      await creditWallet(wallet2.id, nairaToKobo(500), "FUNDING");

      const { sendInternationalTransfer } = await import("@/lib/turbocore/international/send");
      const result = await sendInternationalTransfer({
        userId: user2.id,
        walletId: wallet2.id,
        kycTier: 3,
        sourceCurrency: "NGN",
        destinationCurrency: "USD",
        amountMinor: nairaToKobo(10_000), // Way more than ₦500
        beneficiary: { name: "John Smith", country: "US" },
        purpose: "Test",
      });

      expect(result.success).toBe(false);

      // Cleanup
      await db.wallet.deleteMany({ where: { id: wallet2.id } });
      await db.user.deleteMany({ where: { id: user2.id } });
    });
  });

  describe("Wallet funding", () => {
    it("has sufficient funds for a small transfer", async () => {
      // Verify the test wallet is funded
      const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
      expect(wallet).not.toBeNull();
      expect(wallet!.balanceKobo).toBeGreaterThanOrEqual(nairaToKobo(1_000_000));
    });
  });
});
