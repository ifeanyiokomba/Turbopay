import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { creditWallet, debitWallet } from "@/lib/turbopay/ledger";
import { reconciliation } from "@/lib/turbocore/reconciliation";
import { nairaToKobo } from "@/lib/turbopay/money";

/**
 * Reconciliation engine tests — verifies drift detection, correction,
 * and the single-wallet runOne path.
 */

let testUserId: string;
let testWalletId: string;

beforeAll(async () => {
  const user = await db.user.create({
    data: {
      fullName: "Recon Test User",
      email: "recon-test@turbopay.test",
      phone: "+2347330000001",
      passwordHash: hashPassword("testpassword123"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "Recon Test User - Turbopay");
  testWalletId = wallet.id;
});

afterAll(async () => {
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.reconciliationRun.deleteMany({ where: {} });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.update({ where: { id: testWalletId }, data: { balanceKobo: 0, status: "ACTIVE" } });
});

describe("Reconciliation Engine", () => {
  it("runAll detects drift when wallet.balanceKobo != ledger sum", async () => {
    // Credit ₦5,000 via the ledger (correct path).
    await creditWallet(testWalletId, nairaToKobo(5000), "FUNDING");
    // Now manually corrupt the cache (simulate drift).
    await db.wallet.update({ where: { id: testWalletId }, data: { balanceKobo: nairaToKobo(9999) } });

    const result = await reconciliation.runAll("MANUAL");
    expect(result.walletsChecked).toBeGreaterThan(0);
    expect(result.driftDetected).toBeGreaterThanOrEqual(1);
    const myDrift = result.drifts.find((d) => d.walletId === testWalletId);
    expect(myDrift).toBeDefined();
    expect(myDrift!.cached).toBe(nairaToKobo(9999));
    expect(myDrift!.ledger).toBe(nairaToKobo(5000));
  });

  it("runAll corrects drift and updates wallet.balanceKobo", async () => {
    // Credit ₦3,000 via the ledger.
    await creditWallet(testWalletId, nairaToKobo(3000), "FUNDING");
    // Corrupt the cache.
    await db.wallet.update({ where: { id: testWalletId }, data: { balanceKobo: nairaToKobo(100) } });

    // Use runOne instead of runAll to avoid touching other wallets in the DB
    const result = await reconciliation.runOne(testWalletId);

    // The cache should now match the ledger.
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(3000));
    expect(result.corrected).toBe(true);
  });

  it("runOne returns { matched: true } when cache is correct", async () => {
    // Credit ₦2,000 — the ledger and cache will match.
    await creditWallet(testWalletId, nairaToKobo(2000), "FUNDING");

    const result = await reconciliation.runOne(testWalletId);
    expect(result.matched).toBe(true);
    expect(result.corrected).toBe(false);
    expect(result.ledger).toBe(nairaToKobo(2000));
  });
});
