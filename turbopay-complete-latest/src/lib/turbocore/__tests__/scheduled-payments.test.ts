import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { creditWallet } from "@/lib/turbopay/ledger";
import { scheduledPayments } from "@/lib/turbocore/scheduled-payments";
import { nairaToKobo } from "@/lib/turbopay/money";

/**
 * Scheduled Payments orchestrator tests — verifies `execute()`:
 *   - executes a due internal TRANSFER: debits the sender wallet, credits the
 *     recipient wallet, posts paired ledger entries + both Transaction rows,
 *     returns the transaction reference.
 *   - refuses to debit on INSUFFICIENT_FUNDS — marks the row FAILED, leaves
 *     the wallet untouched, posts NO ledger entries.
 *   - is idempotent — a second execute() within the 60s window is skipped
 *     (`result.skipped === true`), no second debit, no second Transaction row.
 *   - enforces the per-execution amount cap (₦5,000 / 500_000 kobo) — rows
 *     above the cap are skipped with `AMOUNT_EXCEEDS_SCHEDULED_CAP`, no debit.
 *
 * Tests run against the real (SQLite dev) database. Each user/wallet/sp is
 * created fresh in `beforeAll` and torn down in `afterAll`.
 */

let senderUserId: string;
let senderWalletId: string;
let recipientUserId: string;
let recipientWalletId: string;
let poorUserId: string;
let poorWalletId: string;

beforeAll(async () => {
  // ── Sender (well-funded Tier 3 user).
  const sender = await db.user.create({
    data: {
      fullName: "Scheduled Sender",
      email: "sched-sender@turbopay.test",
      phone: "+2347330000100",
      passwordHash: hashPassword("testpassword123"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
      status: "ACTIVE",
    },
  });
  senderUserId = sender.id;
  const { wallet: senderWallet } = await ensureWallet(sender.id, "Scheduled Sender - Turbopay");
  senderWalletId = senderWallet.id;
  // Fund ₦10,000 via the ledger (source of truth).
  await creditWallet(senderWalletId, nairaToKobo(10000), "FUNDING");

  // ── Recipient (a second Turbopay user so resolveTurbopayRecipient finds them).
  const recipient = await db.user.create({
    data: {
      fullName: "Scheduled Recipient",
      email: "sched-recipient@turbopay.test",
      phone: "+2347330000101",
      passwordHash: hashPassword("testpassword123"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
      status: "ACTIVE",
    },
  });
  recipientUserId = recipient.id;
  const { wallet: recipientWallet } = await ensureWallet(recipient.id, "Scheduled Recipient - Turbopay");
  recipientWalletId = recipientWallet.id;
  // Recipient starts at 0 kobo.

  // ── Penniless sender (for the insufficient-funds test).
  const poorUser = await db.user.create({
    data: {
      fullName: "Scheduled Poor Sender",
      email: "sched-poor@turbopay.test",
      phone: "+2347330000102",
      passwordHash: hashPassword("testpassword123"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
      status: "ACTIVE",
    },
  });
  poorUserId = poorUser.id;
  const { wallet: poorWallet } = await ensureWallet(poorUser.id, "Scheduled Poor Sender - Turbopay");
  poorWalletId = poorWallet.id;
  // Leave the poor wallet at 0 kobo.
});

afterAll(async () => {
  // Clean up everything these tests can create: scheduled payments, bill
  // payments, airtime/data purchases, transactions, ledger entries, AML
  // flags, audit logs, virtual accounts, wallets, sessions, users.
  for (const userId of [senderUserId, recipientUserId, poorUserId]) {
    await db.scheduledPayment.deleteMany({ where: { userId } });
    await db.airtimeDataPurchase.deleteMany({ where: { userId } });
    await db.billPayment.deleteMany({ where: { userId } });
    await db.transaction.deleteMany({ where: { userId } });
  }
  for (const walletId of [senderWalletId, recipientWalletId, poorWalletId]) {
    await db.ledgerEntry.deleteMany({ where: { walletId } });
  }
  for (const userId of [senderUserId, recipientUserId, poorUserId]) {
    await db.amlFlag.deleteMany({ where: { userId } });
    await db.auditLog.deleteMany({ where: { userId } });
    await db.virtualAccount.deleteMany({ where: { userId } });
    await db.wallet.deleteMany({ where: { userId } });
    await db.session.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } });
  }
  await db.$disconnect();
});

describe("Scheduled Payments — execute()", () => {
  it("executes a due internal TRANSFER: debits sender, credits recipient, posts ledger entries + Transaction rows", async () => {
    // Snapshot balances before.
    const senderBefore = await db.wallet.findUnique({ where: { id: senderWalletId } });
    const recipientBefore = await db.wallet.findUnique({ where: { id: recipientWalletId } });
    const senderBalanceBefore = senderBefore!.balanceKobo; // ₦10,000
    const recipientBalanceBefore = recipientBefore!.balanceKobo; // 0

    // Create a due scheduled TRANSFER to the recipient's email.
    const sp = await scheduledPayments.create(senderUserId, {
      type: "TRANSFER",
      frequency: "ONCE",
      nextExecutionAt: new Date(), // due now
      recipient: "sched-recipient@turbopay.test",
      recipientName: "Scheduled Recipient",
      amountKobo: nairaToKobo(1000), // ₦1,000 — under the ₦5,000 cap
      description: "Scheduled rent",
    });

    // Execute.
    const result = await scheduledPayments.execute(sp);
    expect(result.success).toBe(true);
    expect(result.transactionRef).toBeTruthy();

    // Sender debited ₦1,000.
    const senderAfter = await db.wallet.findUnique({ where: { id: senderWalletId } });
    expect(senderAfter!.balanceKobo).toBe(senderBalanceBefore - nairaToKobo(1000));

    // Recipient credited ₦1,000.
    const recipientAfter = await db.wallet.findUnique({ where: { id: recipientWalletId } });
    expect(recipientAfter!.balanceKobo).toBe(recipientBalanceBefore + nairaToKobo(1000));

    // Ledger entries: sender has FUNDING credit + TRANSFER debit (2),
    // recipient has TRANSFER credit (1).
    const senderEntries = await db.ledgerEntry.findMany({
      where: { walletId: senderWalletId },
      orderBy: { createdAt: "asc" },
    });
    expect(senderEntries).toHaveLength(2);
    expect(senderEntries[0].entryType).toBe("CREDIT"); // FUNDING
    expect(senderEntries[0].refType).toBe("FUNDING");
    expect(senderEntries[1].entryType).toBe("DEBIT"); // TRANSFER
    expect(senderEntries[1].refType).toBe("TRANSFER");
    expect(senderEntries[1].amountKobo).toBe(nairaToKobo(1000));

    const recipientEntries = await db.ledgerEntry.findMany({
      where: { walletId: recipientWalletId },
    });
    expect(recipientEntries).toHaveLength(1);
    expect(recipientEntries[0].entryType).toBe("CREDIT");
    expect(recipientEntries[0].refType).toBe("TRANSFER");
    expect(recipientEntries[0].amountKobo).toBe(nairaToKobo(1000));

    // The debit + credit legs are paired.
    expect(recipientEntries[0].pairId).toBe(senderEntries[1].id);

    // Both Transaction rows exist with the right type + status.
    const senderTx = await db.transaction.findMany({ where: { userId: senderUserId } });
    expect(senderTx).toHaveLength(1);
    expect(senderTx[0].type).toBe("TRANSFER_OUT");
    expect(senderTx[0].direction).toBe("DEBIT");
    expect(senderTx[0].status).toBe("SUCCESS");
    expect(senderTx[0].amountKobo).toBe(nairaToKobo(1000));
    expect(senderTx[0].reference).toBe(result.transactionRef);

    const recipientTx = await db.transaction.findMany({ where: { userId: recipientUserId } });
    expect(recipientTx).toHaveLength(1);
    expect(recipientTx[0].type).toBe("TRANSFER_IN");
    expect(recipientTx[0].direction).toBe("CREDIT");
    expect(recipientTx[0].status).toBe("SUCCESS");
    expect(recipientTx[0].amountKobo).toBe(nairaToKobo(1000));
  });

  it("refuses to debit on INSUFFICIENT_FUNDS — marks the row FAILED, no debit, no ledger entries", async () => {
    // Poor user has 0 kobo. Create a due scheduled TRANSFER for ₦500.
    const sp = await scheduledPayments.create(poorUserId, {
      type: "TRANSFER",
      frequency: "ONCE",
      nextExecutionAt: new Date(),
      recipient: "sched-recipient@turbopay.test",
      recipientName: "Scheduled Recipient",
      amountKobo: nairaToKobo(500),
      description: "Should fail — no funds",
    });

    const walletBefore = await db.wallet.findUnique({ where: { id: poorWalletId } });
    expect(walletBefore!.balanceKobo).toBe(0);

    const result = await scheduledPayments.execute(sp);

    expect(result.success).toBe(false);
    expect(result.error).toBe("INSUFFICIENT_FUNDS");
    expect(result.skipped).toBeUndefined();

    // The row is FAILED with the deterministic error recorded.
    const spAfter = await db.scheduledPayment.findUnique({ where: { id: sp.id } });
    expect(spAfter!.status).toBe("FAILED");
    expect(spAfter!.lastError).toBe("INSUFFICIENT_FUNDS");

    // Wallet was NOT debited.
    const walletAfter = await db.wallet.findUnique({ where: { id: poorWalletId } });
    expect(walletAfter!.balanceKobo).toBe(0);

    // No ledger entries were posted for the poor wallet.
    const entries = await db.ledgerEntry.findMany({ where: { walletId: poorWalletId } });
    expect(entries).toHaveLength(0);

    // No Transaction row was created for the poor user.
    const txs = await db.transaction.findMany({ where: { userId: poorUserId } });
    expect(txs).toHaveLength(0);
  });

  it("is idempotent — a second execute() within the 60s window is skipped, no second debit", async () => {
    // The sender now has ₦9,000 (₦10,000 − ₦1,000 from the first test).
    const sp = await scheduledPayments.create(senderUserId, {
      type: "TRANSFER",
      frequency: "DAILY",
      nextExecutionAt: new Date(),
      recipient: "sched-recipient@turbopay.test",
      recipientName: "Scheduled Recipient",
      amountKobo: nairaToKobo(500),
      description: "Idempotency test",
    });

    // First execution — succeeds.
    const r1 = await scheduledPayments.execute(sp);
    expect(r1.success).toBe(true);
    expect(r1.transactionRef).toBeTruthy();

    // The cron loop calls markExecuted after each execute() — simulate that
    // here so lastExecutedAt is set on the row.
    await scheduledPayments.markExecuted(sp.id, true, undefined);

    // Snapshot the wallet + transaction count after the first execution.
    const walletAfterFirst = await db.wallet.findUnique({ where: { id: senderWalletId } });
    const balanceAfterFirst = walletAfterFirst!.balanceKobo;
    const txCountAfterFirst = await db.transaction.count({ where: { userId: senderUserId } });

    // Second execution in quick succession — must skip.
    // Re-fetch the row so execute() sees the updated lastExecutedAt.
    const spFresh = (await scheduledPayments.get(sp.id, senderUserId))!;
    const r2 = await scheduledPayments.execute(spFresh);

    expect(r2.success).toBe(false);
    expect(r2.skipped).toBe(true);
    expect(r2.error).toBe("ALREADY_EXECUTED_RECENTLY");

    // Wallet unchanged — no second debit.
    const walletAfterSecond = await db.wallet.findUnique({ where: { id: senderWalletId } });
    expect(walletAfterSecond!.balanceKobo).toBe(balanceAfterFirst);

    // No new Transaction row created.
    const txCountAfterSecond = await db.transaction.count({ where: { userId: senderUserId } });
    expect(txCountAfterSecond).toBe(txCountAfterFirst);
  });

  it("enforces the per-execution amount cap — payments > ₦5,000 are skipped with AMOUNT_EXCEEDS_SCHEDULED_CAP, no debit", async () => {
    // Snapshot the wallet before.
    const walletBefore = await db.wallet.findUnique({ where: { id: senderWalletId } });
    const balanceBefore = walletBefore!.balanceKobo;

    const sp = await scheduledPayments.create(senderUserId, {
      type: "TRANSFER",
      frequency: "ONCE",
      nextExecutionAt: new Date(),
      recipient: "sched-recipient@turbopay.test",
      recipientName: "Scheduled Recipient",
      amountKobo: nairaToKobo(6000), // ₦6,000 — exceeds the ₦5,000 cap
      description: "Should be skipped — over cap",
    });

    const result = await scheduledPayments.execute(sp);

    expect(result.success).toBe(false);
    expect(result.error).toBe("AMOUNT_EXCEEDS_SCHEDULED_CAP");
    expect(result.skipped).toBeUndefined();

    // The row is FAILED (deterministic — retrying won't help).
    const spAfter = await db.scheduledPayment.findUnique({ where: { id: sp.id } });
    expect(spAfter!.status).toBe("FAILED");
    expect(spAfter!.lastError).toBe("AMOUNT_EXCEEDS_SCHEDULED_CAP");

    // Wallet was NOT debited.
    const walletAfter = await db.wallet.findUnique({ where: { id: senderWalletId } });
    expect(walletAfter!.balanceKobo).toBe(balanceBefore);

    // No new ledger DEBIT entry was posted (only the existing FUNDING +
    // prior TRANSFER debits remain).
    const debitEntriesAfter = await db.ledgerEntry.findMany({
      where: { walletId: senderWalletId, entryType: "DEBIT" },
    });
    // Two debits remain from the two prior successful tests (₦1,000 + ₦500).
    // The cap-skipped payment must not have added a third.
    expect(debitEntriesAfter.length).toBe(2);
    expect(debitEntriesAfter.every((e) => e.amountKobo <= nairaToKobo(1000))).toBe(true);
  });
});
