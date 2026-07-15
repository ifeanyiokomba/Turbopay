import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import {
  creditCurrencyWallet,
  debitCurrencyWallet,
  transferBetweenCurrencyWallets,
  getCurrencyWalletBalance,
} from "@/lib/turbopay/ledger";
import { ensureWallet, ensureCurrencyWallets, getCurrencyWallets } from "@/lib/turbopay/wallet";
import { getDefaultCurrency, getSupportedCurrencies } from "@/lib/turbocore/config/country-currency";

let testUserId: string;
let testWalletId: string;
let testCurrencyWalletId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const user = await db.user.create({
    data: {
      fullName: "Multi-Currency Test User",
      email: `mc-wallet-${suffix}@turbopay.test`,
      country: "US",
      phone: `+234700999${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "MC Test User - Turbopay", "US");
  testWalletId = wallet.id;

  // Ensure currency wallets exist
  await ensureCurrencyWallets(user.id, wallet.currency);

  // Find the NGN currency wallet for testing (primary wallet is USD for country=US, so NGN is a CurrencyWallet)
  const ngWallet = await db.currencyWallet.findUnique({
    where: { userId_currency: { userId: user.id, currency: "NGN" } },
  });
  testCurrencyWalletId = ngWallet!.id;
});

afterAll(async () => {
  // Clean up ledger entries for all test wallets
  const wallets = await db.wallet.findMany({ where: { userId: testUserId } });
  for (const w of wallets) {
    await db.ledgerEntry.deleteMany({ where: { walletId: w.id } });
  }
  const cw = await db.currencyWallet.findMany({ where: { userId: testUserId } });
  for (const c of cw) {
    await db.currencyLedgerEntry.deleteMany({ where: { currencyWalletId: c.id } });
  }
  await db.currencyWallet.deleteMany({ where: { userId: testUserId } });
  await db.transaction.deleteMany({ where: { userId: testUserId } });
  await db.wallet.deleteMany({ where: { userId: testUserId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

describe("Country-currency mapping", () => {
  it("returns NGN for Nigeria", () => {
    expect(getDefaultCurrency("NG")).toBe("NGN");
  });

  it("returns USD for United States", () => {
    expect(getDefaultCurrency("US")).toBe("USD");
  });

  it("returns GBP for United Kingdom", () => {
    expect(getDefaultCurrency("GB")).toBe("GBP");
  });

  it("returns EUR for Germany", () => {
    expect(getDefaultCurrency("DE")).toBe("EUR");
  });

  it("returns GHS for Ghana", () => {
    expect(getDefaultCurrency("GH")).toBe("GHS");
  });

  it("falls back to USD for unknown countries", () => {
    expect(getDefaultCurrency("XX")).toBe("USD");
    expect(getDefaultCurrency("ZZ")).toBe("USD");
  });

  it("is case-insensitive", () => {
    expect(getDefaultCurrency("ng")).toBe("NGN");
    expect(getDefaultCurrency("Us")).toBe("USD");
  });

  it("getSupportedCurrencies returns all expected currencies", () => {
    const currencies = getSupportedCurrencies();
    expect(currencies).toContain("NGN");
    expect(currencies).toContain("USD");
    expect(currencies).toContain("GBP");
    expect(currencies).toContain("EUR");
    expect(currencies).toContain("GHS");
    expect(currencies).toContain("KES");
    expect(currencies).toContain("ZAR");
    expect(currencies).toContain("CAD");
    expect(currencies).toContain("AUD");
  });
});

describe("CurrencyWallet provisioning", () => {
  it("ensureCurrencyWallets creates rows for all supported currencies except the primary", async () => {
    const wallets = await getCurrencyWallets(testUserId);
    const currencies = wallets.map((w) => w.currency);
    // Primary wallet is USD (country=US), so USD should NOT be in CurrencyWallet
    expect(currencies).not.toContain("USD");
    // Other supported currencies should be present
    expect(currencies).toContain("NGN");
    expect(currencies).toContain("GBP");
    expect(currencies).toContain("EUR");
  });

  it("ensureCurrencyWallets is idempotent", async () => {
    const before = await db.currencyWallet.count({ where: { userId: testUserId } });
    await ensureCurrencyWallets(testUserId, "USD");
    const after = await db.currencyWallet.count({ where: { userId: testUserId } });
    expect(after).toBe(before);
  });
});

describe("CurrencyWallet ledger operations", () => {
  beforeEach(async () => {
    // Reset currency wallet balance
    await db.currencyWallet.update({
      where: { id: testCurrencyWalletId },
      data: { balanceMinor: 0, status: "ACTIVE" },
    });
    await db.currencyLedgerEntry.deleteMany({ where: { currencyWalletId: testCurrencyWalletId } });
  });

  it("creditCurrencyWallet increments balance correctly", async () => {
    const result = await creditCurrencyWallet(testCurrencyWalletId, 5000, "USD", "FUNDING", {
      description: "Test credit",
    });
    expect(result.ledgerEntryId).toBeTruthy();
    expect(result.balanceAfter).toBe(5000);

    const balance = await getCurrencyWalletBalance(testCurrencyWalletId);
    expect(balance).toBe(5000);
  });

  it("debitCurrencyWallet decrements balance correctly", async () => {
    await creditCurrencyWallet(testCurrencyWalletId, 10000, "USD", "FUNDING");
    const result = await debitCurrencyWallet(testCurrencyWalletId, 3000, "USD", "TRANSFER", {
      description: "Test debit",
    });
    expect(result.balanceAfter).toBe(7000);

    const balance = await getCurrencyWalletBalance(testCurrencyWalletId);
    expect(balance).toBe(7000);
  });

  it("debitCurrencyWallet fails on insufficient funds", async () => {
    await creditCurrencyWallet(testCurrencyWalletId, 1000, "USD", "FUNDING");
    await expect(
      debitCurrencyWallet(testCurrencyWalletId, 5000, "USD", "TRANSFER")
    ).rejects.toThrow();
  });

  it("debitCurrencyWallet fails on frozen wallet", async () => {
    await creditCurrencyWallet(testCurrencyWalletId, 10000, "USD", "FUNDING");
    await db.currencyWallet.update({
      where: { id: testCurrencyWalletId },
      data: { status: "FROZEN" },
    });
    await expect(
      debitCurrencyWallet(testCurrencyWalletId, 1000, "USD", "TRANSFER")
    ).rejects.toThrow();
    // Unfreeze for other tests
    await db.currencyWallet.update({
      where: { id: testCurrencyWalletId },
      data: { status: "ACTIVE" },
    });
  });

  it("getCurrencyWalletBalance matches ledger entries", async () => {
    await creditCurrencyWallet(testCurrencyWalletId, 8000, "USD", "FUNDING");
    await debitCurrencyWallet(testCurrencyWalletId, 2000, "USD", "TRANSFER");
    await creditCurrencyWallet(testCurrencyWalletId, 1500, "USD", "FUNDING");

    const balance = await getCurrencyWalletBalance(testCurrencyWalletId);
    expect(balance).toBe(7500); // 8000 - 2000 + 1500
  });
});

describe("Same-currency transfer between CurrencyWallets", () => {
  let fromWalletId: string;
  let toWalletId: string;

  beforeAll(async () => {
    // Create two GBP currency wallets for transfer testing
    const from = await db.currencyWallet.upsert({
      where: { userId_currency: { userId: testUserId, currency: "GBP" } },
      create: { userId: testUserId, currency: "GBP" },
      update: {},
    });
    const to = await db.currencyWallet.upsert({
      where: { userId_currency: { userId: testUserId, currency: "GBP" } },
      create: { userId: testUserId, currency: "GBP" },
      update: {},
    });
    // Use different wallets — find NGN currency wallet for "to"
    const ngWallet = await db.currencyWallet.findUnique({
      where: { userId_currency: { userId: testUserId, currency: "NGN" } },
    });
    fromWalletId = from.id;
    toWalletId = ngWallet!.id;
  });

  beforeEach(async () => {
    await db.currencyWallet.update({
      where: { id: fromWalletId },
      data: { balanceMinor: 0 },
    });
    await db.currencyWallet.update({
      where: { id: toWalletId },
      data: { balanceMinor: 0 },
    });
    await db.currencyLedgerEntry.deleteMany({ where: { currencyWalletId: fromWalletId } });
    await db.currencyLedgerEntry.deleteMany({ where: { currencyWalletId: toWalletId } });
  });

  it("transfers same amount between two CurrencyWallets atomically", async () => {
    await creditCurrencyWallet(fromWalletId, 10000, "GBP", "FUNDING");
    const result = await transferBetweenCurrencyWallets(fromWalletId, toWalletId, 4000, "GBP", "TRANSFER");
    expect(result.fromBalanceAfter).toBe(6000);
    expect(result.toBalanceAfter).toBe(4000);
  });

  it("fails if source has insufficient funds", async () => {
    await creditCurrencyWallet(fromWalletId, 1000, "GBP", "FUNDING");
    await expect(
      transferBetweenCurrencyWallets(fromWalletId, toWalletId, 5000, "GBP", "TRANSFER")
    ).rejects.toThrow();
  });

  it("rejects transfer to self", async () => {
    await expect(
      transferBetweenCurrencyWallets(fromWalletId, fromWalletId, 1000, "GBP", "TRANSFER")
    ).rejects.toThrow();
  });
});
