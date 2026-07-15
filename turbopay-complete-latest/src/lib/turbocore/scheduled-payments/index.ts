import type { ScheduledPayment } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { checkDebit } from "@/lib/turbopay/aml";
import { LedgerError, transferBetweenWallets } from "@/lib/turbopay/ledger";
import { executeProviderDebit } from "@/lib/turbopay/payments";
import { resolveTurbopayRecipient } from "@/lib/turbopay/wallet";
import { generateReference } from "@/lib/turbopay/reference";
import { providers } from "@/lib/turbocore/providers/registry";
import { acquireUserDebitLock } from "@/lib/turbopay/advisory-lock";
import type { TxType } from "@/lib/turbopay/types";

/**
 * SCHEDULED PAYMENTS SERVICE
 * ==========================
 *
 * Stores user-pre-authorized payment instructions and executes them on a
 * schedule via the `/api/cron/scheduled-payments` cron route.
 *
 * Service-account model: the user authorizes the payment (with PIN) at
 * creation time, so the cron-driven execution does NOT need a PIN. Every
 * execution is audit-logged with `serverInitiated: true` so compliance can
 * distinguish cron-driven money movement from interactive user debits.
 *
 * Safety rails (enforced in `execute()`):
 *  - Idempotency: skip if `lastExecutedAt` is within the last 60 seconds.
 *  - Per-execution amount cap (₦5,000 / 500_000 kobo).
 *  - Pre-flight balance check — insufficient funds mark the row FAILED
 *    immediately (deterministic, retrying won't help).
 *  - AML check still runs (KYC limits + velocity + large-amount rules).
 *  - Each execution is wrapped in try/catch — one failure cannot block others.
 */

/** Per-execution safety cap. Scheduled payments are pre-authorized — cap the
 *  blast radius if a schedule is misconfigured. ₦5,000 = 500_000 kobo. */
const SCHEDULED_AMOUNT_CAP_KOBO = 500_000;

/** Idempotency window — skip if last execution was within this many ms. */
const IDEMPOTENCY_WINDOW_MS = 60_000;

class ScheduledPaymentService {
  async create(userId: string, input: { type: string; frequency: string; nextExecutionAt: Date; endDate?: Date; customDates?: string[]; recipient: string; recipientName?: string; bankName?: string; amountKobo: number; description?: string; productCode?: string; meterType?: string }) {
    const sp = await db.scheduledPayment.create({
      data: { userId, type: input.type, frequency: input.frequency, nextExecutionAt: input.nextExecutionAt, endDate: input.endDate, customDates: input.customDates ? JSON.stringify(input.customDates) : null, recipient: input.recipient, recipientName: input.recipientName, bankName: input.bankName, amountKobo: input.amountKobo, description: input.description, productCode: input.productCode, meterType: input.meterType, status: "ACTIVE" },
    });
    await audit({ userId, action: "SCHEDULED_PAYMENT_CREATED", category: "WALLET", metadata: { id: sp.id, type: input.type, frequency: input.frequency } });
    return sp;
  }

  async list(userId: string) { return db.scheduledPayment.findMany({ where: { userId }, orderBy: { nextExecutionAt: "asc" } }); }

  async get(id: string, userId: string) { return db.scheduledPayment.findFirst({ where: { id, userId } }); }

  async cancel(id: string, userId: string) {
    await db.scheduledPayment.updateMany({ where: { id, userId, status: "ACTIVE" }, data: { status: "CANCELLED" } });
    await audit({ userId, action: "SCHEDULED_PAYMENT_CANCELLED", category: "WALLET", metadata: { id } });
    return { ok: true };
  }

  async pause(id: string, userId: string) {
    await db.scheduledPayment.updateMany({ where: { id, userId, status: "ACTIVE" }, data: { status: "PAUSED" } });
    return { ok: true };
  }

  async resume(id: string, userId: string) {
    await db.scheduledPayment.updateMany({ where: { id, userId, status: "PAUSED" }, data: { status: "ACTIVE" } });
    return { ok: true };
  }

  /** Find payments due for execution (called by a cron job). */
  async findDue() {
    return db.scheduledPayment.findMany({ where: { status: "ACTIVE", nextExecutionAt: { lte: new Date() } }, orderBy: { nextExecutionAt: "asc" }, take: 100 });
  }

  /**
   * Execute a due scheduled payment. Service-account model — the payment was
   * pre-authorized by the user (with PIN) at creation time, so we do NOT
   * re-verify the PIN here. AML still runs.
   *
   * Safety rails (in order):
   *  1. Idempotency — skip if `lastExecutedAt` within the last 60s.
   *  2. Amount cap — skip if `amountKobo > 500_000` (₦5,000). Deterministic,
   *     so the row is marked FAILED immediately (retrying won't help).
   *  3. Pre-flight balance check — insufficient funds mark the row FAILED
   *     immediately and do NOT debit.
   *  4. AML check (KYC limits + velocity + large-amount rules).
   *
   * Then dispatches by `sp.type`:
   *  - TRANSFER → resolveTurbopayRecipient + transferBetweenWallets (internal
   *    only — external scheduled transfers need Paystack and are out of scope).
   *  - AIRTIME / DATA → executeProviderDebit with side row AirtimeDataPurchase.
   *  - BILL_ELECTRICITY / BILL_UTILITY (+ legacy BILL_PAYMENT) →
   *    executeProviderDebit with side row BillPayment.
   *
   * Returns:
   *  - { success: true, transactionRef } on success.
   *  - { success: false, error, skipped?: true } on a controlled failure
   *    (idempotency skip, cap, insufficient funds, AML block, unsupported
   *    type, recipient not found). `skipped: true` means the row was NOT
   *    debited and the cron should NOT call markExecuted (no state change).
   */
  async execute(sp: ScheduledPayment): Promise<{
    success: boolean;
    error?: string;
    transactionRef?: string;
    skipped?: boolean;
  }> {
    // Re-fetch the row to read the latest state (lastExecutedAt, status,
    // failureCount). The caller may be holding a stale snapshot — e.g. the
    // cron loop fetches `due` once at the top, but a prior iteration may
    // have already updated this row.
    const fresh = await db.scheduledPayment.findUnique({ where: { id: sp.id } });
    if (!fresh) return { success: false, error: "SCHEDULED_PAYMENT_NOT_FOUND", skipped: true };
    if (fresh.status !== "ACTIVE") {
      return { success: false, error: `NOT_ACTIVE:${fresh.status}`, skipped: true };
    }

    // 1. Idempotency — skip if executed within the last 60s. Prevents
    //    double-execution if the cron fires twice in quick succession.
    if (fresh.lastExecutedAt) {
      const elapsedMs = Date.now() - fresh.lastExecutedAt.getTime();
      if (elapsedMs < IDEMPOTENCY_WINDOW_MS) {
        await audit({
          userId: fresh.userId,
          action: "SCHEDULED_PAYMENT_EXECUTED",
          category: "WALLET",
          severity: "WARN",
          metadata: {
            scheduledPaymentId: fresh.id,
            type: fresh.type,
            outcome: "SKIPPED_IDEMPOTENCY",
            elapsedMs,
            serverInitiated: true,
          },
        });
        return { success: false, error: "ALREADY_EXECUTED_RECENTLY", skipped: true };
      }
    }

    // 2. Amount cap — ₦5,000 per execution. Deterministic: mark FAILED
    //    immediately so the schedule doesn't keep retrying against the cap.
    if (fresh.amountKobo > SCHEDULED_AMOUNT_CAP_KOBO) {
      await db.scheduledPayment.update({
        where: { id: fresh.id },
        data: { status: "FAILED", lastError: "AMOUNT_EXCEEDS_SCHEDULED_CAP", failureCount: 3 },
      });
      await audit({
        userId: fresh.userId,
        action: "SCHEDULED_PAYMENT_EXECUTED",
        category: "WALLET",
        severity: "WARN",
        metadata: {
          scheduledPaymentId: fresh.id,
          type: fresh.type,
          amountKobo: fresh.amountKobo,
          capKobo: SCHEDULED_AMOUNT_CAP_KOBO,
          outcome: "SKIPPED_AMOUNT_CAP",
          serverInitiated: true,
        },
      });
      return { success: false, error: "AMOUNT_EXCEEDS_SCHEDULED_CAP" };
    }

    // Load the sender's wallet + user (for AML KYC tier).
    const [wallet, user] = await Promise.all([
      db.wallet.findUnique({ where: { userId: fresh.userId } }),
      db.user.findUnique({ where: { id: fresh.userId }, select: { kycTier: true, status: true, fullName: true } }),
    ]);
    if (!wallet) return { success: false, error: "WALLET_NOT_FOUND" };
    if (!user) return { success: false, error: "USER_NOT_FOUND" };
    if (wallet.status !== "ACTIVE") return { success: false, error: "WALLET_FROZEN" };

    // 3. Pre-flight balance check — insufficient funds are deterministic.
    //    Mark FAILED immediately so the row doesn't keep retrying.
    if (wallet.balanceKobo < fresh.amountKobo) {
      await db.scheduledPayment.update({
        where: { id: fresh.id },
        data: { status: "FAILED", lastError: "INSUFFICIENT_FUNDS", failureCount: 3 },
      });
      await audit({
        userId: fresh.userId,
        action: "SCHEDULED_PAYMENT_EXECUTED",
        category: "WALLET",
        severity: "WARN",
        metadata: {
          scheduledPaymentId: fresh.id,
          type: fresh.type,
          amountKobo: fresh.amountKobo,
          balanceKobo: wallet.balanceKobo,
          outcome: "SKIPPED_INSUFFICIENT_FUNDS",
          serverInitiated: true,
        },
      });
      return { success: false, error: "INSUFFICIENT_FUNDS" };
    }

    // 4. AML check (KYC limits + velocity + large-amount). The cron has no
    //    session context, but the user's KYC tier + transaction history are
    //    enough for the rule engine. Wrapped in a transaction with advisory
    //    lock to prevent the F6 race condition (check-then-act gap).
    const amlResult = await db.$transaction(async (tx) => {
      await acquireUserDebitLock(tx, fresh.userId);
      return checkDebit(fresh.userId, wallet.id, fresh.amountKobo, user.kycTier as 1 | 2 | 3, tx);
    }, { timeout: 15000 });
    if (!amlResult.allowed) {
      await audit({
        userId: fresh.userId,
        action: "SCHEDULED_PAYMENT_EXECUTED",
        category: "WALLET",
        severity: "WARN",
        metadata: {
          scheduledPaymentId: fresh.id,
          type: fresh.type,
          amountKobo: fresh.amountKobo,
          outcome: "BLOCKED_AML",
          amlReason: amlResult.reason ?? null,
          serverInitiated: true,
        },
      });
      return { success: false, error: amlResult.reason ?? "AML_BLOCKED" };
    }

    // Dispatch by type. Each helper is wrapped in try/catch by the caller
    // (cron route) — but we also catch here so a provider error becomes a
    // controlled { success: false } rather than a thrown exception.
    try {
      switch (fresh.type) {
        case "TRANSFER":
          return await this.executeTransfer(fresh, wallet.id, user.fullName);
        case "AIRTIME":
        case "DATA":
          return await this.executeAirtimeData(fresh, wallet.id);
        case "BILL_ELECTRICITY":
        case "BILL_UTILITY":
        case "BILL_PAYMENT": // legacy enum value still stored on some rows
          return await this.executeBill(fresh, wallet.id);
        default:
          return { success: false, error: `UNSUPPORTED_TYPE:${fresh.type}` };
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message };
    }
  }

  // ─── TRANSFER (internal Turbopay → Turbopay only) ──────────────────────

  private async executeTransfer(
    sp: ScheduledPayment,
    senderWalletId: string,
    senderFullName: string,
  ): Promise<{ success: boolean; error?: string; transactionRef?: string }> {
    const rec = await resolveTurbopayRecipient(sp.recipient);
    if (!rec) {
      // External scheduled transfers need Paystack + recipient bank details
      // — out of scope for this orchestrator. Surface a clear, distinct
      // error code so the cron log explains the skip.
      await audit({
        userId: sp.userId,
        action: "SCHEDULED_PAYMENT_EXECUTED",
        category: "WALLET",
        severity: "WARN",
        metadata: {
          scheduledPaymentId: sp.id,
          type: "TRANSFER",
          recipient: sp.recipient,
          outcome: "SKIPPED_EXTERNAL_TRANSFER_NOT_SUPPORTED",
          serverInitiated: true,
        },
      });
      return { success: false, error: "EXTERNAL_TRANSFER_NOT_SUPPORTED" };
    }
    if (rec.user.id === sp.userId) return { success: false, error: "SELF_TRANSFER" };
    if (!rec.wallet || rec.wallet.status !== "ACTIVE" || rec.user.status !== "ACTIVE") {
      return { success: false, error: "RECIPIENT_NOT_ACTIVE" };
    }
    const recipientWallet = rec.wallet;

    const noteText = sp.description?.trim() || `Scheduled transfer to ${rec.user.fullName}`;

    let transactionRef: string;
    try {
      const result = await db.$transaction(async (tx) => {
        const transfer = await transferBetweenWallets(
          senderWalletId,
          recipientWallet.id,
          sp.amountKobo,
          "TRANSFER",
          { description: noteText },
          tx,
        );
        const outTx = await tx.transaction.create({
          data: {
            reference: generateReference("TP"),
            userId: sp.userId,
            walletId: senderWalletId,
            type: "TRANSFER_OUT" as TxType,
            direction: "DEBIT",
            amountKobo: sp.amountKobo,
            description: noteText,
            counterpartyName: rec.user.fullName,
            counterpartyAccount: rec.vaccount?.accountNumber ?? (rec.user.phone ?? "unknown"),
            counterpartyBank: rec.vaccount?.bankName ?? "Turbopay MFB",
            provider: "turbopay",
            status: "SUCCESS",
            metadata: JSON.stringify({
              scheduledPaymentId: sp.id,
              serverInitiated: true,
              ledgerEntryId: transfer.debitEntryId,
            }),
          },
        });
        await tx.transaction.create({
          data: {
            reference: generateReference("TP"),
            userId: rec.user.id,
            walletId: recipientWallet.id,
            type: "TRANSFER_IN" as TxType,
            direction: "CREDIT",
            amountKobo: sp.amountKobo,
            description: `Scheduled transfer from ${senderFullName}`,
            counterpartyName: senderFullName,
            counterpartyAccount: "scheduled",
            counterpartyBank: "Turbopay MFB",
            provider: "turbopay",
            status: "SUCCESS",
            metadata: JSON.stringify({
              scheduledPaymentId: sp.id,
              serverInitiated: true,
              ledgerEntryId: transfer.creditEntryId,
            }),
          },
        });
        return { transactionRef: outTx.reference };
      }, { timeout: 15000 });
      transactionRef = result.transactionRef;
    } catch (e: unknown) {
      if (e instanceof LedgerError) {
        return { success: false, error: e.code };
      }
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message };
    }

    await audit({
      userId: sp.userId,
      action: "SCHEDULED_PAYMENT_EXECUTED",
      category: "WALLET",
      severity: "WARN",
      metadata: {
        scheduledPaymentId: sp.id,
        type: "TRANSFER",
        amountKobo: sp.amountKobo,
        recipientUserId: rec.user.id,
        transactionRef,
        outcome: "EXECUTED",
        serverInitiated: true,
      },
    });

    return { success: true, transactionRef };
  }

  // ─── AIRTIME / DATA (provider-backed debit via Baxi) ───────────────────

  private async executeAirtimeData(
    sp: ScheduledPayment,
    walletId: string,
  ): Promise<{ success: boolean; error?: string; transactionRef?: string }> {
    const isData = sp.type === "DATA";
    const txType: TxType = isData ? "DATA" : "AIRTIME";
    const refType: "AIRTIME" | "DATA" = isData ? "DATA" : "AIRTIME";
    const network = sp.recipientName ?? "UNKNOWN";
    const description = sp.description?.trim() || (isData ? `Scheduled data — ${sp.recipient}` : `Scheduled airtime — ${sp.recipient}`);
    const providerReference = generateReference("BAX");
    const productCode = sp.productCode ?? (isData ? `DATA:${network}` : `AIRTIME:${network}`);

    let result;
    try {
      result = await executeProviderDebit({
        userId: sp.userId,
        walletId,
        type: txType,
        refType,
        amountKobo: sp.amountKobo,
        description,
        counterpartyName: network,
        counterpartyAccount: sp.recipient,
        provider: "baxi",
        metadata: { scheduledPaymentId: sp.id, serverInitiated: true, providerReference, network },
        sideModel: "airtimeData",
        createSideRow: async (tx, transactionId) => {
          const row = await tx.airtimeDataPurchase.create({
            data: {
              userId: sp.userId,
              transactionId,
              type: txType,
              phoneNumber: sp.recipient,
              network,
              amountKobo: sp.amountKobo,
              status: "PENDING",
              reference: providerReference,
              provider: "baxi",
            },
          });
          return row.id;
        },
        providerCall: async () => {
          const bp = await providers.billPayment();
          const r = await bp.pay({
            productCode,
            customer: sp.recipient,
            customerName: network,
            amountMinor: sp.amountKobo,
            currency: "NGN",
            reference: providerReference,
          });
          if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Provider call failed");
          return { providerRef: r.data.providerRef };
        },
      });
    } catch (e: any) {
      // executeProviderDebit has already reversed the hold + marked the
      // Transaction FAILED. Surface the error code.
      return { success: false, error: e?.code ?? (e instanceof Error ? e.message : String(e)) };
    }

    await audit({
      userId: sp.userId,
      action: "SCHEDULED_PAYMENT_EXECUTED",
      category: "WALLET",
      severity: "WARN",
      metadata: {
        scheduledPaymentId: sp.id,
        type: sp.type,
        amountKobo: sp.amountKobo,
        transactionRef: result.reference,
        providerRef: result.providerRef,
        outcome: "EXECUTED",
        serverInitiated: true,
      },
    });

    return { success: true, transactionRef: result.reference };
  }

  // ─── BILL_ELECTRICITY / BILL_UTILITY (provider-backed debit via Baxi) ──

  private async executeBill(
    sp: ScheduledPayment,
    walletId: string,
  ): Promise<{ success: boolean; error?: string; transactionRef?: string }> {
    const isElectricity = sp.type === "BILL_ELECTRICITY";
    const txType: TxType = isElectricity ? "BILL_ELECTRICITY" : "BILL_UTILITY";
    const category = isElectricity ? "ELECTRICITY" : "UTILITY";
    const customerName = sp.recipientName ?? "Scheduled";
    const description = sp.description?.trim() || `Scheduled bill — ${sp.recipient}`;
    const providerReference = generateReference("BAX");
    const productCode = sp.productCode ?? `BILL:${category}`;

    let result;
    try {
      result = await executeProviderDebit({
        userId: sp.userId,
        walletId,
        type: txType,
        refType: "BILL",
        amountKobo: sp.amountKobo,
        description,
        counterpartyName: sp.recipientName ?? sp.recipient,
        counterpartyAccount: sp.recipient,
        provider: "baxi",
        metadata: {
          scheduledPaymentId: sp.id,
          serverInitiated: true,
          providerReference,
          category,
          meterType: sp.meterType ?? null,
        },
        sideModel: "billPayment",
        createSideRow: async (tx, transactionId) => {
          const row = await tx.billPayment.create({
            data: {
              userId: sp.userId,
              transactionId,
              category,
              provider: "baxi",
              customer: sp.recipient,
              customerName,
              product: sp.productCode ?? `Scheduled ${category}`,
              amountKobo: sp.amountKobo,
              feeKobo: 0,
              status: "PENDING",
              reference: providerReference,
            },
          });
          return row.id;
        },
        providerCall: async () => {
          const bp = await providers.billPayment();
          const r = await bp.pay({
            productCode,
            customer: sp.recipient,
            customerName,
            amountMinor: sp.amountKobo,
            currency: "NGN",
            ...(sp.meterType ? { meterType: sp.meterType as "PREPAID" | "POSTPAID" } : {}),
            reference: providerReference,
          });
          if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Provider call failed");
          return { providerRef: r.data.providerRef };
        },
      });
    } catch (e: any) {
      return { success: false, error: e?.code ?? (e instanceof Error ? e.message : String(e)) };
    }

    await audit({
      userId: sp.userId,
      action: "SCHEDULED_PAYMENT_EXECUTED",
      category: "WALLET",
      severity: "WARN",
      metadata: {
        scheduledPaymentId: sp.id,
        type: sp.type,
        amountKobo: sp.amountKobo,
        transactionRef: result.reference,
        providerRef: result.providerRef,
        outcome: "EXECUTED",
        serverInitiated: true,
      },
    });

    return { success: true, transactionRef: result.reference };
  }

  /** Mark a scheduled payment as executed + compute next run date. */
  async markExecuted(id: string, success: boolean, error?: string) {
    const sp = await db.scheduledPayment.findUnique({ where: { id } });
    if (!sp) return;
    // If the row was already finalized (FAILED by execute()'s deterministic
    // safety rails, or COMPLETED / CANCELLED by the user), do NOT override
    // the state — a deterministic INSUFFICIENT_FUNDS must not flip back to
    // ACTIVE just because the cron also called markExecuted(false).
    if (sp.status === "FAILED" || sp.status === "COMPLETED" || sp.status === "CANCELLED") return;
    let nextExecutionAt: Date | null = sp.nextExecutionAt;
    if (success) {
      nextExecutionAt = this.computeNextRun(sp.frequency, sp.nextExecutionAt, sp.customDates ? JSON.parse(sp.customDates) : null);
      if (!nextExecutionAt || (sp.endDate && nextExecutionAt > sp.endDate)) {
        await db.scheduledPayment.update({ where: { id }, data: { status: "COMPLETED", lastExecutedAt: new Date(), executionCount: { increment: 1 } } });
      } else {
        await db.scheduledPayment.update({ where: { id }, data: { lastExecutedAt: new Date(), executionCount: { increment: 1 }, nextExecutionAt, failureCount: 0, lastError: null } });
      }
    } else {
      const failCount = sp.failureCount + 1;
      await db.scheduledPayment.update({ where: { id }, data: { failureCount: failCount, lastError: error ?? "Execution failed", status: failCount >= 3 ? "FAILED" : "ACTIVE" } });
    }
  }

  private computeNextRun(frequency: string, currentDate: Date, customDates?: string[] | null): Date | null {
    const now = new Date(currentDate);
    switch (frequency) {
      case "ONCE": return null;
      case "DAILY": return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case "WEEKLY": return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      case "MONTHLY": { const d = new Date(now); d.setMonth(d.getMonth() + 1); return d; }
      case "CUSTOM": {
        if (!customDates || customDates.length === 0) return null;
        const future = customDates.map(d => new Date(d)).filter(d => d > now).sort((a, b) => a.getTime() - b.getTime());
        return future[0] ?? null;
      }
      default: return null;
    }
  }
}

export const scheduledPayments = new ScheduledPaymentService();
