import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { ensureWallet, createTransactionRecord } from "@/lib/turbopay/wallet";
import { creditWallet, debitWallet } from "@/lib/turbopay/ledger";
import { disputes } from "@/lib/turbocore/disputes";
import { nairaToKobo } from "@/lib/turbopay/money";

/**
 * Disputes service tests — verify auto-refund on RESOLVED_FAVOUR_USER,
 * idempotency (no double-refund), and SLA-breach detection.
 *
 * Tests run against the real (SQLite dev) database. A single test user +
 * wallet is created in `beforeAll` and torn down in `afterAll`; each test
 * creates its own transaction + dispute so they don't interfere.
 */

let testUserId: string;
let testWalletId: string;

beforeAll(async () => {
  const user = await db.user.create({
    data: {
      fullName: "Disputes Test User",
      email: "disputes-test@turbopay.test",
      phone: "+2347330000078",
      passwordHash: hashPassword("testpassword123"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
      status: "ACTIVE",
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "Disputes Test User - Turbopay");
  testWalletId = wallet.id;
  // Fund ₦10,000 so subsequent debit + refund cycles have headroom.
  await creditWallet(testWalletId, nairaToKobo(10000), "FUNDING");
});

afterAll(async () => {
  // Tear down everything these tests can create: dispute messages/attachments,
  // disputes, transactions, ledger entries, AML flags, audit logs, virtual
  // accounts, wallets, sessions, and the user.
  await db.disputeMessage.deleteMany({
    where: { dispute: { userId: testUserId } },
  });
  await db.dispute.deleteMany({ where: { userId: testUserId } });
  await db.transaction.deleteMany({ where: { userId: testUserId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.amlFlag.deleteMany({ where: { userId: testUserId } });
  await db.auditLog.deleteMany({ where: { userId: testUserId } });
  await db.virtualAccount.deleteMany({ where: { userId: testUserId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.session.deleteMany({ where: { userId: testUserId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

/**
 * Helper: simulate a "user was debited ₦X" transaction (e.g. an airtime
 * purchase). Posts a real DEBIT ledger leg + a Transaction record so the
 * dispute service can reverse it.
 */
async function createDebitedTransaction(amountNaira: number, description: string) {
  const amountKobo = nairaToKobo(amountNaira);
  await debitWallet(testWalletId, amountKobo, "AIRTIME", {
    description,
  });
  const tx = await createTransactionRecord({
    userId: testUserId,
    walletId: testWalletId,
    type: "AIRTIME",
    direction: "DEBIT",
    amountKobo,
    status: "SUCCESS",
    description,
    provider: "baxi",
  });
  // The createTransactionRecord helper doesn't set the ledger entry refId
  // (the debitWallet call posts the ledger leg first, without knowing the
  // tx id). Back-link the ledger entry to the transaction so the dispute
  // service's `findMany({ where: { refId: tx.id } })` picks it up.
  await db.ledgerEntry.updateMany({
    where: {
      walletId: testWalletId,
      entryType: "DEBIT",
      refId: null,
      refType: "AIRTIME",
    },
    data: { refId: tx.id },
  });
  return tx;
}

describe("Disputes — auto-refund on RESOLVED_FAVOUR_USER", () => {
  it("resolving a dispute in the user's favour credits the wallet + reverses the transaction", async () => {
    // Setup: ₦2,000 airtime debit.
    const tx = await createDebitedTransaction(2000, "Airtime MTN — disputed");
    const walletBefore = await db.wallet.findUnique({ where: { id: testWalletId } });
    const balanceBefore = walletBefore!.balanceKobo;

    const dispute = await disputes.create(testUserId, {
      transactionId: tx.id,
      type: "UNAUTHORIZED_TRANSACTION",
      subject: "I did not authorise this airtime purchase",
      description: "Phone was stolen; this purchase is fraudulent.",
      amountDisputedKobo: tx.amountKobo,
      priority: "HIGH",
    });

    // Resolve in the user's favour.
    const updated = await disputes.update(
      dispute.id,
      { status: "RESOLVED_FAVOUR_USER", resolution: "Refunded — unauthorised tx" },
      // Use the real testUserId as actor.id so the audit-log FK constraint
      // is satisfied (AuditLog.userId → User.id).
      { id: testUserId, name: "Test Admin" },
    );
    expect(updated.status).toBe("RESOLVED_FAVOUR_USER");
    expect(updated.resolvedAt).toBeTruthy();

    // The wallet cache was credited back by the dispute refund.
    const walletAfter = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(walletAfter!.balanceKobo).toBe(balanceBefore + tx.amountKobo);

    // The original transaction is now REVERSED.
    const originalTx = await db.transaction.findUnique({ where: { id: tx.id } });
    expect(originalTx!.status).toBe("REVERSED");

    // A REVERSAL Transaction record was created, opposite direction (CREDIT),
    // back-linked via reversalOfId.
    const reversalTx = await db.transaction.findFirst({
      where: { userId: testUserId, type: "REVERSAL", reversalOfId: tx.id },
    });
    expect(reversalTx).toBeTruthy();
    expect(reversalTx!.direction).toBe("CREDIT");
    expect(reversalTx!.amountKobo).toBe(tx.amountKobo);
    expect(reversalTx!.status).toBe("SUCCESS");

    // The dispute metadata now carries the refund idempotency flag.
    const refreshed = await db.dispute.findUnique({ where: { id: dispute.id } });
    const meta = refreshed!.metadata ? JSON.parse(refreshed!.metadata) : {};
    expect(meta.refundedAt).toBeTruthy();
    expect(meta.refundReversalTransactionId).toBe(reversalTx!.id);
    expect(meta.refundAmountKobo).toBe(tx.amountKobo);
  });

  it("is idempotent — resolving twice does NOT double-refund", async () => {
    // Setup: a fresh ₦1,500 debit + dispute.
    const tx = await createDebitedTransaction(1500, "Airtime Airtel — idempotency test");
    const dispute = await disputes.create(testUserId, {
      transactionId: tx.id,
      type: "DUPLICATE_CHARGE",
      subject: "Duplicate charge",
      description: "Charged twice for the same airtime.",
      amountDisputedKobo: tx.amountKobo,
    });

    // First resolution — refund fires.
    await disputes.update(
      dispute.id,
      { status: "RESOLVED_FAVOUR_USER", resolution: "Refunded" },
      { id: testUserId, name: "Test Admin" },
    );
    const walletAfterFirst = await db.wallet.findUnique({ where: { id: testWalletId } });
    const balanceAfterFirst = walletAfterFirst!.balanceKobo;
    const txCountAfterFirst = await db.transaction.count({
      where: { userId: testUserId, type: "REVERSAL" },
    });

    // Second resolution call — no refund, no new ledger entries, no new txs.
    await disputes.update(
      dispute.id,
      { status: "RESOLVED_FAVOUR_USER", resolutionNotes: "Confirming closure" },
      { id: testUserId, name: "Test Admin" },
    );

    const walletAfterSecond = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(walletAfterSecond!.balanceKobo).toBe(balanceAfterFirst);

    const txCountAfterSecond = await db.transaction.count({
      where: { userId: testUserId, type: "REVERSAL" },
    });
    expect(txCountAfterSecond).toBe(txCountAfterFirst);

    // The dispute is still RESOLVED_FAVOUR_USER and still has exactly one
    // refundedAt timestamp (the original).
    const refreshed = await db.dispute.findUnique({ where: { id: dispute.id } });
    const meta = refreshed!.metadata ? JSON.parse(refreshed!.metadata) : {};
    expect(meta.refundedAt).toBeTruthy();
    expect(refreshed!.status).toBe("RESOLVED_FAVOUR_USER");
  });

  it("is idempotent across status transitions — FAVOUR_USER → PLATFORM → FAVOUR_USER does not double-refund", async () => {
    // Setup: a fresh ₦1,000 debit + dispute.
    const tx = await createDebitedTransaction(1000, "Airtime Glo — toggle test");
    const dispute = await disputes.create(testUserId, {
      transactionId: tx.id,
      type: "INCORRECT_DEBIT",
      subject: "Wrong amount debited",
      description: "Debited the wrong amount.",
      amountDisputedKobo: tx.amountKobo,
    });

    // 1. Resolve in user's favour — refund fires.
    await disputes.update(dispute.id, { status: "RESOLVED_FAVOUR_USER" });
    const walletAfterFirst = await db.wallet.findUnique({ where: { id: testWalletId } });
    const balanceAfterFirst = walletAfterFirst!.balanceKobo;

    // 2. Admin flips to PLATFORM (no refund change expected — the dispute is
    //    already resolved; metadata flag is still set).
    await disputes.update(dispute.id, { status: "RESOLVED_FAVOUR_PLATFORM" });
    const walletAfterPlatform = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(walletAfterPlatform!.balanceKobo).toBe(balanceAfterFirst);

    // 3. Admin flips back to FAVOUR_USER — must NOT refund again.
    await disputes.update(dispute.id, { status: "RESOLVED_FAVOUR_USER" });
    const walletAfterBack = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(walletAfterBack!.balanceKobo).toBe(balanceAfterFirst);

    // Only one REVERSAL transaction exists for this original tx.
    const reversals = await db.transaction.findMany({
      where: { userId: testUserId, type: "REVERSAL", reversalOfId: tx.id },
    });
    expect(reversals).toHaveLength(1);
  });

  it("resolving in the platform's favour does NOT refund", async () => {
    const tx = await createDebitedTransaction(750, "Airtime 9mobile — platform wins");
    const walletBefore = await db.wallet.findUnique({ where: { id: testWalletId } });
    const balanceBefore = walletBefore!.balanceKobo;

    const dispute = await disputes.create(testUserId, {
      transactionId: tx.id,
      type: "BILL_PAYMENT_ISSUE",
      subject: "Bill didn't go through",
      description: "Customer claims bill failed; provider confirms success.",
      amountDisputedKobo: tx.amountKobo,
    });

    await disputes.update(
      dispute.id,
      { status: "RESOLVED_FAVOUR_PLATFORM", resolution: "Provider confirmed payment" },
      { id: testUserId, name: "Test Admin" },
    );

    // Wallet unchanged — no refund.
    const walletAfter = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(walletAfter!.balanceKobo).toBe(balanceBefore);

    // Original transaction is NOT reversed.
    const originalTx = await db.transaction.findUnique({ where: { id: tx.id } });
    expect(originalTx!.status).toBe("SUCCESS");

    // No REVERSAL transaction was created.
    const reversal = await db.transaction.findFirst({
      where: { userId: testUserId, type: "REVERSAL", reversalOfId: tx.id },
    });
    expect(reversal).toBeNull();

    // No refund metadata was set.
    const refreshed = await db.dispute.findUnique({ where: { id: dispute.id } });
    const meta = refreshed!.metadata ? JSON.parse(refreshed!.metadata) : {};
    expect(meta.refundedAt).toBeUndefined();
  });
});

describe("Disputes — SLA breach detection", () => {
  it("checkSlaBreaches flags OPEN disputes whose slaDueAt has passed", async () => {
    // Create an OPEN dispute with an old slaDueAt (12 hours ago).
    const dispute = await disputes.create(testUserId, {
      type: "OTHER",
      subject: "SLA breach test",
      description: "Dispute for SLA breach detection.",
    });
    // Override the slaDueAt to the past (create() sets it 72h in the future).
    await db.dispute.update({
      where: { id: dispute.id },
      data: { slaDueAt: new Date(Date.now() - 12 * 60 * 60 * 1000) },
    });

    const breached = await disputes.checkSlaBreaches();
    const mine = breached.find((b) => b.id === dispute.id);
    expect(mine).toBeDefined();
    expect(mine!.disputeNumber).toBe(dispute.disputeNumber);
    expect(mine!.userId).toBe(testUserId);
  });

  it("checkSlaBreaches does NOT flag OPEN disputes whose slaDueAt is still in the future", async () => {
    const dispute = await disputes.create(testUserId, {
      type: "OTHER",
      subject: "SLA not yet breached",
      description: "Dispute should NOT appear in breaches.",
      priority: "LOW", // SLA = 168h — comfortably in the future
    });

    const breached = await disputes.checkSlaBreaches();
    const mine = breached.find((b) => b.id === dispute.id);
    expect(mine).toBeUndefined();
  });

  it("checkSlaBreaches does NOT flag already-resolved disputes (even if past SLA)", async () => {
    const dispute = await disputes.create(testUserId, {
      type: "OTHER",
      subject: "Resolved late but resolved",
      description: "Past SLA but resolved — should not flag.",
    });
    // Push slaDueAt to the past AND mark resolved.
    await db.dispute.update({
      where: { id: dispute.id },
      data: {
        slaDueAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        status: "RESOLVED_FAVOUR_PLATFORM",
        resolvedAt: new Date(),
      },
    });

    const breached = await disputes.checkSlaBreaches();
    const mine = breached.find((b) => b.id === dispute.id);
    expect(mine).toBeUndefined();
  });
});
