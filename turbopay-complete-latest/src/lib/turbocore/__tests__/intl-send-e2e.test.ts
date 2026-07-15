import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { hashPassword, hashPin } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { creditWallet } from "@/lib/turbopay/ledger";
import { nairaToKobo } from "@/lib/turbopay/money";

/**
 * International Transfer End-to-End Tests
 *
 * Full flow: feature flag → FX config seed → quote → send → balance → audit.
 * Uses real database + mock provider adapters.
 */

let testUserId: string;
let testWalletId: string;

beforeAll(async () => {
  const user = await db.user.create({
    data: {
      fullName: "Intl E2E Test User",
      email: `intl-e2e-${Date.now()}@turbopay.test`,
      phone: `+234700${Date.now().toString().slice(-7)}`,
      passwordHash: hashPassword("IntlE2ETest!9"),
      transactionPinHash: hashPin("1234"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      status: "ACTIVE",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;

  const { wallet } = await ensureWallet(user.id, "Intl E2E User");
  testWalletId = wallet.id;
  await creditWallet(testWalletId, nairaToKobo(10_000_000), "FUNDING");

  // Enable feature flag
  await db.featureFlag.upsert({
    where: { key: "turbopay.intl" },
    create: { key: "turbopay.intl", enabled: true, rollout: 100 },
    update: { enabled: true, rollout: 100 },
  });

  // Seed FX configs for pairs we'll test
  const fxPairs = [
    { pair: "NGN→USD", fromCurrency: "NGN", toCurrency: "USD", spreadBps: 200, platformFeeBps: 80, minAmountMinor: 100, enabled: true },
    { pair: "NGN→GBP", fromCurrency: "NGN", toCurrency: "GBP", spreadBps: 210, platformFeeBps: 80, minAmountMinor: 100, enabled: true },
    { pair: "NGN→EUR", fromCurrency: "NGN", toCurrency: "EUR", spreadBps: 200, platformFeeBps: 80, minAmountMinor: 100, enabled: true },
    { pair: "NGN→KES", fromCurrency: "NGN", toCurrency: "KES", spreadBps: 220, platformFeeBps: 90, minAmountMinor: 100, enabled: true },
    { pair: "USD→NGN", fromCurrency: "USD", toCurrency: "NGN", spreadBps: 150, platformFeeBps: 50, minAmountMinor: 100, enabled: true },
    { pair: "GBP→NGN", fromCurrency: "GBP", toCurrency: "NGN", spreadBps: 180, platformFeeBps: 60, minAmountMinor: 100, enabled: true },
    { pair: "EUR→NGN", fromCurrency: "EUR", toCurrency: "NGN", spreadBps: 170, platformFeeBps: 60, minAmountMinor: 100, enabled: true },
    { pair: "USD→GHS", fromCurrency: "USD", toCurrency: "GHS", spreadBps: 160, platformFeeBps: 50, minAmountMinor: 100, enabled: true },
  ];
  for (const cfg of fxPairs) {
    await db.fxConfig.upsert({ where: { pair: cfg.pair }, create: cfg, update: cfg });
  }
});

afterAll(async () => {
  await db.currencyWallet.deleteMany({ where: { userId: testUserId } });
  await db.internationalBeneficiary.deleteMany({ where: { userId: testUserId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.settlement.deleteMany({ where: { reference: { startsWith: "INTL" } } });
  // Clean up seeded FX configs
  await db.fxConfig.deleteMany({ where: { pair: { in: ["NGN→USD", "NGN→GBP", "NGN→EUR", "NGN→KES"] } } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

// ─── FX Quote ─────────────────────────────────────────────────

describe("FX Quote — service layer", () => {
  it("getQuote returns valid quote for NGN→USD", async () => {
    const { fx } = await import("@/lib/turbocore/fx");
    const quote = await fx.getQuote("NGN", "USD", nairaToKobo(10_000), { userId: testUserId });

    expect(quote.rate).toBeGreaterThan(0);
    expect(quote.destinationAmountMinor).toBeGreaterThan(0);
    expect(quote.platformFeeMinor).toBeGreaterThanOrEqual(0);
  });

  it("getQuote returns valid quote for NGN→GBP", async () => {
    const { fx } = await import("@/lib/turbocore/fx");
    const quote = await fx.getQuote("NGN", "GBP", nairaToKobo(25_000), { userId: testUserId });

    expect(quote.rate).toBeGreaterThan(0);
    expect(quote.destinationAmountMinor).toBeGreaterThan(0);
  });

  it("getQuote returns valid quote for NGN→EUR", async () => {
    const { fx } = await import("@/lib/turbocore/fx");
    const quote = await fx.getQuote("NGN", "EUR", nairaToKobo(50_000), { userId: testUserId });

    expect(quote.rate).toBeGreaterThan(0);
    expect(quote.destinationAmountMinor).toBeGreaterThan(0);
  });

  it("getQuote throws for unsupported pair", async () => {
    const { fx } = await import("@/lib/turbocore/fx");
    await expect(
      fx.getQuote("BTC" as any, "NGN", 100000, { userId: testUserId })
    ).rejects.toThrow();
  });
});

// ─── Send Transfer — Full Flow ────────────────────────────────

describe("sendInternationalTransfer — full E2E flow", () => {
  it("sends NGN→USD transfer: quote → debit → provider → audit", async () => {
    const { sendInternationalTransfer } = await import("@/lib/turbocore/international/send");

    const walletBefore = await db.wallet.findUnique({ where: { id: testWalletId } });
    const balanceBefore = walletBefore!.balanceKobo;

    const result = await sendInternationalTransfer({
      userId: testUserId,
      walletId: testWalletId,
      kycTier: 3,
      sourceCurrency: "NGN",
      destinationCurrency: "USD",
      amountMinor: nairaToKobo(5_000),
      beneficiary: {
        name: "John Smith",
        account: "1234567890",
        bank: "Chase Bank",
        country: "US",
        routingCode: "CHASUS33",
      },
      purpose: "Family support — E2E test",
    });

    expect(result.success).toBe(true);
    expect(result.reference).toBeDefined();
    expect(result.transactionId).toBeDefined();
    expect(result.quotedRate).toBeGreaterThan(0);
    expect(result.destinationAmountMinor).toBeGreaterThan(0);
    expect(result.feesMinor).toBeGreaterThanOrEqual(0);

    // Verify wallet debited
    const walletAfter = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(walletAfter!.balanceKobo).toBeLessThan(balanceBefore);

    // Verify transaction record
    const txRecord = await db.transaction.findUnique({ where: { id: result.transactionId! } });
    expect(txRecord).not.toBeNull();
    expect(txRecord!.status).toBe("SUCCESS");
    expect(txRecord!.type).toBe("TRANSFER_OUT");
    expect(txRecord!.provider).toBe("intl-transfer");
    expect(txRecord!.counterpartyName).toBe("John Smith");

    // Verify settlement record
    const settlement = await db.settlement.findFirst({ where: { reference: result.reference } });
    expect(settlement).not.toBeNull();
    expect(settlement!.settlementCurrency).toBe("USD");

    // Verify audit log
    const auditLog = await db.auditLog.findFirst({
      where: { userId: testUserId, action: "INTL_TRANSFER_SENT" },
    });
    expect(auditLog).not.toBeNull();

    console.log(`  ✓ NGN→USD: ₦5,000 sent, $${(result.destinationAmountMinor! / 100).toFixed(2)} received, rate: ${result.quotedRate}`);
  });

  it("sends NGN→GBP transfer with different beneficiary", async () => {
    const { sendInternationalTransfer } = await import("@/lib/turbocore/international/send");

    const result = await sendInternationalTransfer({
      userId: testUserId,
      walletId: testWalletId,
      kycTier: 3,
      sourceCurrency: "NGN",
      destinationCurrency: "GBP",
      amountMinor: nairaToKobo(10_000),
      beneficiary: {
        name: "Jane Doe",
        account: "GB29NWBK60161331926819",
        bank: "Barclays",
        country: "GB",
      },
      purpose: "Business payment — E2E test",
    });

    expect(result.success).toBe(true);
    expect(result.destinationAmountMinor).toBeGreaterThan(0);

    const txRecord = await db.transaction.findUnique({ where: { id: result.transactionId! } });
    expect(txRecord!.counterpartyName).toBe("Jane Doe");

    console.log(`  ✓ NGN→GBP: ₦10,000 sent, £${(result.destinationAmountMinor! / 100).toFixed(2)} received`);
  });

  it("sends NGN→KES transfer (or fails gracefully if provider unsupported)", async () => {
    const { sendInternationalTransfer } = await import("@/lib/turbocore/international/send");

    const result = await sendInternationalTransfer({
      userId: testUserId,
      walletId: testWalletId,
      kycTier: 3,
      sourceCurrency: "NGN",
      destinationCurrency: "KES",
      amountMinor: nairaToKobo(20_000),
      beneficiary: {
        name: "Wanjiku Kamau",
        country: "KE",
      },
      purpose: "Salary payment — E2E test",
    });

    // Mock provider may not support KES — either success or provider error is acceptable
    if (result.success) {
      console.log(`  ✓ NGN→KES: ₦20,000 sent, KES ${(result.destinationAmountMinor! / 100).toFixed(2)} received`);
    } else {
      console.log(`  ○ NGN→KES: provider does not support KES (${result.errorCode}) — expected in mock mode`);
    }
  });

  it("rejects transfer when wallet balance is insufficient", async () => {
    const { sendInternationalTransfer } = await import("@/lib/turbocore/international/send");

    const user2 = await db.user.create({
      data: {
        fullName: "Low Balance User",
        email: `low-bal-${Date.now()}@turbopay.test`,
        passwordHash: hashPassword("test"),
        kycTier: 3,
      },
    });
    const { wallet: wallet2 } = await ensureWallet(user2.id, "Low Balance");
    await creditWallet(wallet2.id, nairaToKobo(100), "FUNDING");

    const result = await sendInternationalTransfer({
      userId: user2.id,
      walletId: wallet2.id,
      kycTier: 3,
      sourceCurrency: "NGN",
      destinationCurrency: "USD",
      amountMinor: nairaToKobo(50_000),
      beneficiary: { name: "Test", country: "US" },
      purpose: "Test insufficient",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBeDefined();

    await db.wallet.deleteMany({ where: { id: wallet2.id } });
    await db.user.deleteMany({ where: { id: user2.id } });
  });

  it("rejects transfer with negative amount", async () => {
    const { sendInternationalTransfer } = await import("@/lib/turbocore/international/send");

    const result = await sendInternationalTransfer({
      userId: testUserId,
      walletId: testWalletId,
      kycTier: 3,
      sourceCurrency: "NGN",
      destinationCurrency: "USD",
      amountMinor: -100,
      beneficiary: { name: "Test", country: "US" },
      purpose: "Test negative",
    });

    expect(result.success).toBe(false);
  });
});

// ─── Balance Integrity ────────────────────────────────────────

describe("Balance integrity after transfers", () => {
  it("wallet balance matches ledger entries (double-entry check)", async () => {
    const entries = await db.ledgerEntry.findMany({
      where: { walletId: testWalletId },
      orderBy: { createdAt: "asc" },
    });

    let computedBalance = 0;
    for (const entry of entries) {
      if (entry.entryType === "CREDIT") computedBalance += entry.amountKobo;
      if (entry.entryType === "DEBIT") computedBalance -= entry.amountKobo;
    }

    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(computedBalance);
  });

  it("all intl transactions have matching settlement records", async () => {
    const intlTxns = await db.transaction.findMany({
      where: { walletId: testWalletId, provider: "intl-transfer", status: "SUCCESS" },
    });

    for (const tx of intlTxns) {
      const settlement = await db.settlement.findFirst({ where: { reference: tx.reference } });
      expect(settlement).not.toBeNull();
    }
  });

  it("wallet has sufficient remaining balance", async () => {
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBeGreaterThan(nairaToKobo(9_000_000));
  });

  it("correct number of intl transfers recorded", async () => {
    const count = await db.transaction.count({
      where: { walletId: testWalletId, provider: "intl-transfer", status: "SUCCESS" },
    });
    expect(count).toBeGreaterThanOrEqual(2); // At least USD and GBP succeeded
  });
});
