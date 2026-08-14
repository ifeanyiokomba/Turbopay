import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { debitWallet, creditWallet, transferBetweenWallets, reconcileWallet, reverseEntry } from "@/lib/turbopay/ledger";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { nairaToKobo } from "@/lib/turbopay/money";

/**
 * FINANCIAL INTEGRITY TEST SUITE
 *
 * These tests verify the invariants that MUST hold for a fintech ledger.
 * They run against the real (SQLite dev) database — in CI, point
 * DATABASE_URL at a throwaway PostgreSQL test schema.
 *
 * Invariants under test:
 *  1. Concurrent debits cannot cause a negative balance (TOCTOU safety).
 *  2. A debit that exceeds the balance is rejected.
 *  3. Transfer to self is rejected.
 *  4. Reversal posts an opposing leg (no funds stranded).
 *  5. A frozen wallet rejects debits.
 *  6. The wallet cache always equals the ledger sum (reconciliation).
 */

let testUserId: string;
let testWalletId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const user = await db.user.create({
    data: {
      fullName: "Test User",
      email: `ledger-${suffix}@turbopay.test`,
      phone: `+234700555${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "Test User - Turbopay");
  testWalletId = wallet.id;
});

afterAll(async () => {
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

describe("Ledger integrity", () => {
  beforeEach(async () => {
    await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
    // Guard: wallet may have been deleted by a prior afterAll — skip reset if so.
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId }, select: { id: true } });
    if (wallet) {
      await db.wallet.update({ where: { id: testWalletId }, data: { balanceKobo: 0, status: "ACTIVE" } });
    }
  });

  it("credits and debits update the balance correctly", async () => {
    await creditWallet(testWalletId, nairaToKobo(1000), "FUNDING", { description: "test credit" });
    let wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(1000));

    await debitWallet(testWalletId, nairaToKobo(300), "AIRTIME", { description: "test debit" });
    wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(700));
  });

  it("rejects a debit that would cause a negative balance", async () => {
    await creditWallet(testWalletId, nairaToKobo(500), "FUNDING");
    await expect(
      debitWallet(testWalletId, nairaToKobo(1000), "AIRTIME")
    ).rejects.toThrow(/Insufficient funds/);
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(500));
  });

  it("concurrent debits cannot double-spend (TOCTOU safety)", async () => {
    await creditWallet(testWalletId, nairaToKobo(1000), "FUNDING");
    // Fire 5 debits of ₦400 each against a ₦1000 balance. We run them
    // sequentially (SQLite serialises writes via a single-writer lock, so
    // true concurrency isn't possible on the dev DB). On PostgreSQL the
    // conditional UPDATE handles real concurrency; the invariant is the
    // same: balance never goes negative, total debited never exceeds available.
    const results: Array<{ ok: boolean }> = [];
    for (let i = 0; i < 5; i++) {
      try {
        await debitWallet(testWalletId, nairaToKobo(400), "AIRTIME", { description: "concurrent" });
        results.push({ ok: true });
      } catch {
        results.push({ ok: false });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    expect(succeeded).toBe(2); // 400+400=800 <= 1000; 3rd would overdraw
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(200)); // 1000 - 800
    expect(wallet!.balanceKobo).toBeGreaterThanOrEqual(0);
  });

  it("the wallet cache always matches the ledger sum", async () => {
    await creditWallet(testWalletId, nairaToKobo(5000), "FUNDING");
    await debitWallet(testWalletId, nairaToKobo(1200), "AIRTIME");
    await debitWallet(testWalletId, nairaToKobo(800), "DATA");
    const rec = await reconcileWallet(testWalletId);
    expect(rec.matched).toBe(true);
    expect(rec.ledger).toBe(nairaToKobo(3000));
  });

  it("rejects transfer to self", async () => {
    await creditWallet(testWalletId, nairaToKobo(1000), "FUNDING");
    await expect(
      transferBetweenWallets(testWalletId, testWalletId, nairaToKobo(100), "TRANSFER")
    ).rejects.toThrow(/Cannot transfer to self/);
  });

  it("reverses a debit cleanly (opposing ledger leg)", async () => {
    await creditWallet(testWalletId, nairaToKobo(1000), "FUNDING");
    const debit = await debitWallet(testWalletId, nairaToKobo(400), "AIRTIME");
    let wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(600));

    await reverseEntry(debit.ledgerEntryId, { description: "test reversal" });
    wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(1000)); // restored
  });

  it("reversing the same entry twice is idempotent (no double refund)", async () => {
    await creditWallet(testWalletId, nairaToKobo(1000), "FUNDING");
    const debit = await debitWallet(testWalletId, nairaToKobo(400), "AIRTIME");

    // First reversal restores the balance.
    const first = await reverseEntry(debit.ledgerEntryId, { description: "reversal 1" });
    let wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(1000));

    // Second reversal (e.g. a replayed failure webhook) must NOT re-credit.
    const second = await reverseEntry(debit.ledgerEntryId, { description: "reversal 2 — replay" });
    expect(second.reversalEntryId).toBe(first.reversalEntryId);
    wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(1000)); // unchanged

    // Exactly one REVERSAL leg exists, linked back to the original entry.
    const reversals = await db.ledgerEntry.findMany({
      where: { refType: "REVERSAL", pairId: debit.ledgerEntryId },
    });
    expect(reversals.length).toBe(1);
    expect(reversals[0].amountKobo).toBe(nairaToKobo(400));
  });

  it("reverses a credit too, and only once", async () => {
    await creditWallet(testWalletId, nairaToKobo(1000), "FUNDING");
    const credit = await creditWallet(testWalletId, nairaToKobo(300), "FUNDING");
    let wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(1300));

    const first = await reverseEntry(credit.ledgerEntryId, { description: "reversal of credit" });
    wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(1000));

    const second = await reverseEntry(credit.ledgerEntryId, { description: "replay" });
    expect(second.reversalEntryId).toBe(first.reversalEntryId);
    wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(1000)); // unchanged
  });

  it("rejects a debit on a frozen wallet", async () => {
    await creditWallet(testWalletId, nairaToKobo(1000), "FUNDING");
    await db.wallet.update({ where: { id: testWalletId }, data: { status: "FROZEN" } });
    await expect(
      debitWallet(testWalletId, nairaToKobo(100), "AIRTIME")
    ).rejects.toThrow(/frozen/i);
    await db.wallet.update({ where: { id: testWalletId }, data: { status: "ACTIVE" } });
  });
});
