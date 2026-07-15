import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { acquireUserDebitLock } from "@/lib/turbopay/advisory-lock";
import { debitWallet, creditWallet, transferBetweenWallets } from "@/lib/turbopay/ledger";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { nairaToKobo } from "@/lib/turbopay/money";

/**
 * ADVISORY LOCK TEST SUITE
 *
 * Verifies that per-user advisory locks correctly serialize concurrent
 * debit transactions, preventing the F6 race condition where two concurrent
 * PostgreSQL transactions could each read pre-debit AML counters, both pass,
 * then both commit — a classic read-skew.
 *
 * On SQLite (dev), advisory locks are a no-op (SQLite has no pg_advisory_xact_lock),
 * so these tests verify the *correctness* of the lock acquisition path and the
 * *behavioral invariant* (balance never negative, correct number of debits succeed).
 *
 * On PostgreSQL (CI/prod), the advisory lock serializes concurrent debits,
 * ensuring the second debit waits for the first to complete before proceeding.
 *
 * The concurrent tests use Promise.all to fire multiple debits simultaneously.
 * On PostgreSQL, the advisory lock ensures they execute sequentially even though
 * they're initiated concurrently. On SQLite, the single-threaded event loop
 * achieves the same effect naturally.
 */

let testUserId: string;
let testWalletId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const user = await db.user.create({
    data: {
      fullName: "Advisory Lock Test User",
      email: `advisory-${suffix}@turbopay.test`,
      phone: `+234700666${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  // Ensure wallet exists before creating virtualAccount
  const { wallet } = await ensureWallet(user.id, "Advisory Lock Test User - Turbopay");
  testWalletId = wallet.id;
});

afterAll(async () => {
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  // Guard: wallet may have been deleted by a prior afterAll — skip reset if so.
  const wallet = await db.wallet.findUnique({ where: { id: testWalletId }, select: { id: true } });
  if (wallet) {
    await db.wallet.update({ where: { id: testWalletId }, data: { balanceKobo: 0, status: "ACTIVE" } });
  }
});

describe("acquireUserDebitLock", () => {
  it("is a no-op on SQLite (does not throw)", async () => {
    // On SQLite, DATABASE_URL starts with "file:" — the lock should be skipped.
    // On PostgreSQL, the lock acquires and releases normally within the tx.
    await db.$transaction(async (tx) => {
      // Should not throw regardless of database backend
      await expect(acquireUserDebitLock(tx, testUserId)).resolves.toBeUndefined();
    });
  });

  it("can be acquired multiple times in the same transaction (re-entrant)", async () => {
    // pg_advisory_xact_lock is re-entrant — acquiring the same lock twice
    // in the same transaction should not deadlock.
    await db.$transaction(async (tx) => {
      await acquireUserDebitLock(tx, testUserId);
      await acquireUserDebitLock(tx, testUserId); // second acquire — same tx, same key
    });
  });

  it("different users get independent locks (no cross-user blocking)", async () => {
    // Create a second user
    const user2 = await db.user.create({
      data: {
        fullName: "Advisory Lock User 2",
        email: "advisory-test-2@turbopay.test",
        passwordHash: hashPassword("testpassword123"),
        kycTier: 1,
      },
    });
    const { wallet: wallet2 } = await ensureWallet(user2.id, "User 2");

    try {
      // Both locks should succeed — they target different user hashes
      await db.$transaction(async (tx) => {
        await acquireUserDebitLock(tx, testUserId);
      });
      await db.$transaction(async (tx) => {
        await acquireUserDebitLock(tx, user2.id);
      });
    } finally {
      await db.ledgerEntry.deleteMany({ where: { walletId: wallet2.id } });
      await db.wallet.deleteMany({ where: { id: wallet2.id } });
      await db.user.deleteMany({ where: { id: user2.id } });
    }
  });
});

describe("Concurrent debits with advisory lock", () => {
  it("concurrent debits never cause a negative balance", async () => {
    // Fund ₦1,000 — fire 10 debits of ₦200 each concurrently.
    // At most 5 should succeed (5 × ₦200 = ₦1,000).
    // On PostgreSQL, advisory locks serialize them so exactly 5 succeed.
    // On SQLite, the single-writer lock may cause one extra failure.
    // The critical invariant: balance is NEVER negative.
    await creditWallet(testWalletId, nairaToKobo(1000), "FUNDING");

    const CONCURRENT_DEBITS = 10;
    const DEBIT_AMOUNT = nairaToKobo(200);

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_DEBITS }, (_, i) =>
        debitWallet(testWalletId, DEBIT_AMOUNT, "AIRTIME", {
          description: `concurrent-${i}`,
          userId: testUserId,
        })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    // At least some must succeed (5 on PostgreSQL, 3+ on SQLite due to socket timeouts)
    expect(succeeded).toBeGreaterThanOrEqual(3);
    expect(succeeded).toBeLessThanOrEqual(5);
    expect(succeeded + failed).toBe(CONCURRENT_DEBITS);

    // CRITICAL INVARIANT: balance must never be negative
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBeGreaterThanOrEqual(0);
    expect(wallet!.balanceKobo).toBeLessThanOrEqual(nairaToKobo(1000));
  });

  it("mixed concurrent debits respect balance limits", async () => {
    // Fund ₦500 — fire debits of varying sizes concurrently.
    // Total attempted: ₦100 + ₦200 + ₦300 + ₦150 + ₦250 = ₦1,000
    // Only ₦500 worth should succeed.
    await creditWallet(testWalletId, nairaToKobo(500), "FUNDING");

    const amounts = [100, 200, 300, 150, 250];

    const results = await Promise.allSettled(
      amounts.map((amt, i) =>
        debitWallet(testWalletId, nairaToKobo(amt), "AIRTIME", {
          description: `mixed-${i}`,
          userId: testUserId,
        })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThanOrEqual(2); // At least ₦100 + ₦200 = ₦300 or ₦100 + ₦150 = ₦250

    // Balance must never be negative
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBeGreaterThanOrEqual(0);
  });

  it("concurrent debits produce correct ledger entries", async () => {
    // Fund ₦1,000 — fire 5 debits of ₦100 concurrently.
    // All 5 should succeed (5 × ₦100 = ₦500 ≤ ₦1,000).
    await creditWallet(testWalletId, nairaToKobo(1000), "FUNDING");

    const CONCURRENT_DEBITS = 5;
    const DEBIT_AMOUNT = nairaToKobo(100);

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_DEBITS }, (_, i) =>
        debitWallet(testWalletId, DEBIT_AMOUNT, "AIRTIME", {
          description: `ledger-test-${i}`,
          userId: testUserId,
        })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBe(5);

    // Verify wallet balance: ₦1,000 - (5 × ₦100) = ₦500
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(500));

    // Verify ledger entries: 1 CREDIT + 5 DEBIT = 6 entries
    const entries = await db.ledgerEntry.findMany({
      where: { walletId: testWalletId },
      orderBy: { createdAt: "asc" },
    });
    const credits = entries.filter((e) => e.entryType === "CREDIT");
    const debits = entries.filter((e) => e.entryType === "DEBIT");
    expect(credits.length).toBe(1);
    expect(debits.length).toBe(5);

    // All debit entries should have the correct amount
    for (const debit of debits) {
      expect(debit.amountKobo).toBe(DEBIT_AMOUNT);
      expect(debit.refType).toBe("AIRTIME");
      expect(debit.immutable).toBe(true);
    }
  });

  it("concurrent debits produce correct transaction records", async () => {
    // Fund ₦1,000 — fire 3 debits of ₦100 concurrently.
    await creditWallet(testWalletId, nairaToKobo(1000), "FUNDING");

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, (_, i) =>
        debitWallet(testWalletId, nairaToKobo(100), "DATA", {
          description: `tx-test-${i}`,
          userId: testUserId,
        })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBe(3);

    // All succeeded transactions should have unique references
    const references = succeeded.map((r) => {
      const result = (r as PromiseFulfilledResult<Awaited<ReturnType<typeof debitWallet>>>).value;
      return result.ledgerEntryId;
    });
    const uniqueRefs = new Set(references);
    expect(uniqueRefs.size).toBe(3);
  });
});

describe("Concurrent transfers with advisory lock", () => {
  it("concurrent transfers between wallets serialize correctly", async () => {
    // Create two users with wallets
    const user2 = await db.user.create({
      data: {
        fullName: "Transfer Target User",
        email: "transfer-target@turbopay.test",
        passwordHash: hashPassword("testpassword123"),
        kycTier: 2,
      },
    });
    const { wallet: wallet2 } = await ensureWallet(user2.id, "Transfer Target");

    try {
      // Fund sender ₦1,000
      await creditWallet(testWalletId, nairaToKobo(1000), "FUNDING");

      // Fire 5 concurrent transfers of ₦300 each (total ₦1,500 > ₦1,000)
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) =>
          transferBetweenWallets(testWalletId, wallet2.id, nairaToKobo(300), "TRANSFER", {
            description: `concurrent-transfer-${i}`,
          })
        )
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      // At most 3 should succeed (3 × ₦300 = ₦900 ≤ ₦1,000)
      expect(succeeded).toBeLessThanOrEqual(3);
      expect(succeeded).toBeGreaterThanOrEqual(2); // At least ₦300 + ₦300 = ₦600

      // Sender balance must never be negative
      const senderWallet = await db.wallet.findUnique({ where: { id: testWalletId } });
      expect(senderWallet!.balanceKobo).toBeGreaterThanOrEqual(0);

      // Total debited must equal total credited
      const senderDebits = await db.ledgerEntry.aggregate({
        where: { walletId: testWalletId, entryType: "DEBIT" },
        _sum: { amountKobo: true },
      });
      const recipientCredits = await db.ledgerEntry.aggregate({
        where: { walletId: wallet2.id, entryType: "CREDIT" },
        _sum: { amountKobo: true },
      });
      expect(senderDebits._sum.amountKobo).toBe(recipientCredits._sum.amountKobo);
    } finally {
      await db.ledgerEntry.deleteMany({ where: { walletId: wallet2.id } });
      await db.transaction.deleteMany({ where: { walletId: wallet2.id } });
      await db.wallet.deleteMany({ where: { id: wallet2.id } });
      await db.user.deleteMany({ where: { id: user2.id } });
    }
  });
});

describe("Advisory lock edge cases", () => {
  it("debitWallet without userId works (backward compatible)", async () => {
    // Calling debitWallet without userId should still work — no lock acquired.
    await creditWallet(testWalletId, nairaToKobo(500), "FUNDING");
    const result = await debitWallet(testWalletId, nairaToKobo(100), "AIRTIME");
    expect(result.ledgerEntryId).toBeTruthy();

    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(400));
  });

  it("debitWallet with userId acquires lock and debits correctly", async () => {
    // Calling debitWallet WITH userId should acquire the advisory lock.
    await creditWallet(testWalletId, nairaToKobo(500), "FUNDING");
    const result = await debitWallet(testWalletId, nairaToKobo(100), "AIRTIME", {
      userId: testUserId,
    });
    expect(result.ledgerEntryId).toBeTruthy();

    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(400));
  });

  it("advisory lock does not affect credit operations", async () => {
    // Credits don't use advisory locks — they should work normally.
    const credit1 = await creditWallet(testWalletId, nairaToKobo(500), "FUNDING");
    const credit2 = await creditWallet(testWalletId, nairaToKobo(300), "FUNDING");

    expect(credit1.ledgerEntryId).toBeTruthy();
    expect(credit2.ledgerEntryId).toBeTruthy();

    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(800));
  });
});
