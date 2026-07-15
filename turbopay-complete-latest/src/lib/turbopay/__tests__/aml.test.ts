import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { checkDebit } from "@/lib/turbopay/aml";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { creditWallet } from "@/lib/turbopay/ledger";
import { nairaToKobo } from "@/lib/turbopay/money";

/**
 * AML / Risk engine tests — covers KYC tier limits, daily cumulative limits,
 * and the HIGH-severity auto-freeze behaviour.
 */

let testUserId: string;
let testWalletId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const user = await db.user.create({
    data: {
      fullName: "AML Test User",
      email: `aml-${suffix}@turbopay.test`,
      phone: `+234722111${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 1,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  // Ensure wallet exists before creating virtualAccount
  const { wallet } = await ensureWallet(user.id, "AML Test User - Turbopay");
  testWalletId = wallet.id;
});

afterAll(async () => {
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.amlFlag.deleteMany({ where: { userId: testUserId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

beforeEach(async () => {
  // Reset wallet + user state before each test.
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.amlFlag.deleteMany({ where: { userId: testUserId } });
  // Guard: records may have been deleted by a prior afterAll — skip reset if so.
  const wallet = await db.wallet.findUnique({ where: { id: testWalletId }, select: { id: true } });
  if (wallet) {
    await db.wallet.update({ where: { id: testWalletId }, data: { balanceKobo: 0, status: "ACTIVE" } });
  }
  const user = await db.user.findUnique({ where: { id: testUserId }, select: { id: true } });
  if (user) {
    await db.user.update({ where: { id: testUserId }, data: { status: "ACTIVE", kycTier: 1 } });
  }
});

describe("checkDebit (AML)", () => {
  it("blocks a single transaction above KYC Tier 1 limit (₦50,000)", async () => {
    // Tier 1 single-tx limit is ₦50,000 (5,000,000 kobo).
    const result = await checkDebit(testUserId, testWalletId, nairaToKobo(60_000), 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("single-transaction limit");
  });

  it("blocks when daily cumulative exceeds tier limit", async () => {
    // Fund the wallet so balance isn't the blocker.
    await creditWallet(testWalletId, nairaToKobo(200_000), "FUNDING");
    // Create prior debits totalling ₦100,000 (Tier 1 daily limit is ₦150,000).
    for (let i = 0; i < 3; i++) {
      await db.transaction.create({
        data: {
          reference: `TP-PRIOR-${i}`,
          userId: testUserId, walletId: testWalletId, type: "AIRTIME", direction: "DEBIT",
          amountKobo: nairaToKobo(40_000), status: "SUCCESS",
        },
      });
    }
    // ₦40,000 × 3 = ₦120,000 already debited; ₦40,000 more would be ₦160,000 > ₦150,000.
    const result = await checkDebit(testUserId, testWalletId, nairaToKobo(40_000), 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("daily transaction limit");
  });

  it("HIGH severity auto-freezes wallet (sets wallet.status = FROZEN)", async () => {
    // Fund the wallet.
    await creditWallet(testWalletId, nairaToKobo(10_000), "FUNDING");
    // Create 10 debits in the last hour to trigger VELOCITY (HIGH severity).
    for (let i = 0; i < 10; i++) {
      await db.transaction.create({
        data: {
          reference: `TP-VEL-${i}`,
          userId: testUserId, walletId: testWalletId, type: "AIRTIME", direction: "DEBIT",
          amountKobo: nairaToKobo(100), status: "SUCCESS",
          createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
        },
      });
    }
    const result = await checkDebit(testUserId, testWalletId, nairaToKobo(100), 1);
    expect(result.allowed).toBe(false);
    // Verify the wallet was frozen.
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId }, select: { status: true } });
    expect(wallet!.status).toBe("FROZEN");
  });

  it("HIGH severity returns { allowed: false, frozeWallet: true }", async () => {
    // Fund the wallet.
    await creditWallet(testWalletId, nairaToKobo(10_000), "FUNDING");
    // Create 3 transfer_out in 5 minutes to trigger RAPID_TRANSFER (HIGH).
    for (let i = 0; i < 3; i++) {
      await db.transaction.create({
        data: {
          reference: `TP-RAP-${i}`,
          userId: testUserId, walletId: testWalletId, type: "TRANSFER_OUT", direction: "DEBIT",
          amountKobo: nairaToKobo(100), status: "SUCCESS",
          createdAt: new Date(Date.now() - 3 * 60 * 1000),
        },
      });
    }
    const result = await checkDebit(testUserId, testWalletId, nairaToKobo(100), 1);
    expect(result.allowed).toBe(false);
    expect(result.frozeWallet).toBe(true);
  });
});
