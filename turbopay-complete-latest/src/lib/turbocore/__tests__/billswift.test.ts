import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { creditWallet } from "@/lib/turbopay/ledger";
import { billswift } from "@/lib/turbocore/billswift";
import { nairaToKobo } from "@/lib/turbopay/money";

/**
 * BillSwift bulk processing tests — verifies `processNextBulkItem`:
 *   - processes a due item (hold + provider + confirm), debits the wallet,
 *     marks the item SUCCESS with providerRef + transactionId.
 *   - is idempotent: a second call does NOT re-process the same item and
 *     does NOT debit the wallet again.
 *   - on a pre-flight failure (e.g. INSUFFICIENT_FUNDS), marks the item
 *     FAILED, does NOT debit the wallet, ticks failedCount on the parent job.
 *
 * Tests run against the real (SQLite dev) database. Each user/wallet/job is
 * created fresh in `beforeAll` and torn down in `afterAll`.
 */

let testUserId: string;
let testWalletId: string;

let poorUserId: string;
let poorWalletId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  // ── Well-funded user (Tier 3, plenty of balance for ₦500 debits).
  const user = await db.user.create({
    data: {
      fullName: "BillSwift Test User",
      email: `billswift-${suffix}@turbopay.test`,
      phone: `+234733333${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
      status: "ACTIVE",
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "BillSwift Test User - Turbopay");
  testWalletId = wallet.id;
  // Fund ₦10,000 via the ledger (the source of truth).
  await creditWallet(testWalletId, nairaToKobo(10000), "FUNDING");

  // ── Penniless user (for the failure-path test).
  const poorSuffix = Math.floor(Math.random() * 1_000_000).toString();
  const poorUser = await db.user.create({
    data: {
      fullName: "BillSwift Poor User",
      email: `billswift-poor-${poorSuffix}@turbopay.test`,
      phone: `+234733444${poorSuffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
      status: "ACTIVE",
    },
  });
  poorUserId = poorUser.id;
  const { wallet: poorWallet } = await ensureWallet(
    poorUser.id,
    "BillSwift Poor User - Turbopay"
  );
  poorWalletId = poorWallet.id;
  // Leave the poor wallet at 0 kobo.
});

afterAll(async () => {
  // Clean up everything these tests can create: receipts, bill payments,
  // bulk items, bulk jobs, transactions, ledger entries, AML flags,
  // virtual accounts, wallets, sessions, audit logs, and finally the users.
  for (const userId of [testUserId, poorUserId]) {
    await db.receipt.deleteMany({ where: { userId } });
    await db.billPayment.deleteMany({ where: { userId } });
    const jobs = await db.billSwiftBulkJob.findMany({
      where: { userId },
      select: { id: true },
    });
    if (jobs.length > 0) {
      await db.billSwiftBulkItem.deleteMany({
        where: { jobId: { in: jobs.map((j) => j.id) } },
      });
      await db.billSwiftBulkJob.deleteMany({ where: { userId } });
    }
    await db.transaction.deleteMany({ where: { userId } });
  }
  for (const walletId of [testWalletId, poorWalletId]) {
    await db.ledgerEntry.deleteMany({ where: { walletId } });
  }
  for (const userId of [testUserId, poorUserId]) {
    await db.amlFlag.deleteMany({ where: { userId } });
    await db.auditLog.deleteMany({ where: { userId } });
    await db.virtualAccount.deleteMany({ where: { userId } });
    await db.wallet.deleteMany({ where: { userId } });
    await db.session.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } });
  }
  await db.$disconnect();
});

describe("BillSwift — processNextBulkItem", () => {
  it("processes a due item: debits the wallet, marks SUCCESS, sets providerRef + transactionId", async () => {
    // Snapshot the wallet balance before processing.
    const before = await db.wallet.findUnique({ where: { id: testWalletId } });
    const balanceBefore = before!.balanceKobo;

    const amountNaira = 500;
    const { jobId } = await billswift.createBulkJob(testUserId, [
      {
        productCode: "IKEDC",
        customer: "04172219014",
        customerName: "Bulk Test Customer",
        amountNaira,
        meterType: "PREPAID",
      },
    ]);

    const result = await billswift.processNextBulkItem(jobId);

    // The structured result reports success.
    expect(result.processed).toBe(true);
    expect(result.success).toBe(true);
    expect(result.itemId).toBeTruthy();
    expect(result.jobId).toBe(jobId);
    expect(result.providerRef).toBeTruthy();
    expect(result.transactionId).toBeTruthy();
    expect(result.newBalanceKobo).toBe(balanceBefore - nairaToKobo(amountNaira));

    // The item row is now SUCCESS with providerRef + transactionId set.
    const items = await db.billSwiftBulkItem.findMany({
      where: { jobId },
      orderBy: { rowIndex: "asc" },
    });
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("SUCCESS");
    expect(items[0].providerRef).toBe(result.providerRef);
    expect(items[0].transactionId).toBe(result.transactionId);

    // The wallet cache was debited by the orchestrator's holdDebit.
    const after = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(after!.balanceKobo).toBe(balanceBefore - nairaToKobo(amountNaira));

    // The parent job counters tick.
    const job = await db.billSwiftBulkJob.findUnique({ where: { id: jobId } });
    expect(job!.processedItems).toBe(1);
    expect(job!.successCount).toBe(1);
    expect(job!.failedCount).toBe(0);
    expect(job!.status).toBe("COMPLETED");

    // A Transaction row was created with type BILL_UTILITY + provider billswift.
    const tx = await db.transaction.findUnique({
      where: { id: result.transactionId },
    });
    expect(tx).toBeTruthy();
    expect(tx!.type).toBe("BILL_UTILITY");
    expect(tx!.provider).toBe("billswift");
    expect(tx!.status).toBe("SUCCESS");
    expect(tx!.amountKobo).toBe(nairaToKobo(amountNaira));

    // A BillPayment side row was created with provider billswift + a real ref.
    const sideRows = await db.billPayment.findMany({
      where: { transactionId: result.transactionId },
    });
    expect(sideRows).toHaveLength(1);
    expect(sideRows[0].provider).toBe("billswift");
    expect(sideRows[0].status).toBe("SUCCESS");
    expect(sideRows[0].reference).not.toBe("PENDING");
  });

  it("is idempotent — a second call does NOT re-process and does NOT debit again", async () => {
    // The previous test left one job fully processed (status COMPLETED,
    // one SUCCESS item). Snapshot the wallet + transaction count.
    const walletBefore = await db.wallet.findUnique({
      where: { id: testWalletId },
    });
    const balanceBefore = walletBefore!.balanceKobo;

    const txCountBefore = await db.transaction.count({
      where: { userId: testUserId },
    });

    // Call again with no jobId — should report NO_PENDING_ITEMS across all jobs.
    const result = await billswift.processNextBulkItem();
    expect(result.processed).toBe(false);
    expect(result.reason).toBe("NO_PENDING_ITEMS");

    // Wallet balance unchanged.
    const walletAfter = await db.wallet.findUnique({
      where: { id: testWalletId },
    });
    expect(walletAfter!.balanceKobo).toBe(balanceBefore);

    // No new transactions created.
    const txCountAfter = await db.transaction.count({
      where: { userId: testUserId },
    });
    expect(txCountAfter).toBe(txCountBefore);
  });

  it("marks the item FAILED on a pre-flight error (insufficient funds) and does NOT debit", async () => {
    // The poor user has a wallet with 0 kobo. Create a bulk job for ₦500.
    const amountNaira = 500;
    const { jobId } = await billswift.createBulkJob(poorUserId, [
      {
        productCode: "IKEDC",
        customer: "04172219015",
        customerName: "Poor Customer",
        amountNaira,
        meterType: "PREPAID",
      },
    ]);

    const walletBefore = await db.wallet.findUnique({
      where: { id: poorWalletId },
    });
    const balanceBefore = walletBefore!.balanceKobo; // 0
    expect(balanceBefore).toBe(0);

    const result = await billswift.processNextBulkItem(jobId);

    // The item was processed but NOT successful.
    expect(result.processed).toBe(true);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INSUFFICIENT_FUNDS");

    // The item row is FAILED with the error message recorded.
    const items = await db.billSwiftBulkItem.findMany({
      where: { jobId },
    });
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("FAILED");
    expect(items[0].error).toBe("INSUFFICIENT_FUNDS");
    expect(items[0].providerRef).toBeNull();
    expect(items[0].transactionId).toBeNull();

    // The wallet was NOT debited (no funds were ever held because the
    // pre-flight balance check short-circuited before the orchestrator).
    const walletAfter = await db.wallet.findUnique({
      where: { id: poorWalletId },
    });
    expect(walletAfter!.balanceKobo).toBe(balanceBefore);

    // No Transaction row was created for this item.
    const txs = await db.transaction.findMany({
      where: { userId: poorUserId },
    });
    expect(txs).toHaveLength(0);

    // The parent job counters tick on the failure side.
    const job = await db.billSwiftBulkJob.findUnique({ where: { id: jobId } });
    expect(job!.processedItems).toBe(1);
    expect(job!.failedCount).toBe(1);
    expect(job!.successCount).toBe(0);
    expect(job!.status).toBe("COMPLETED");
  });
});
