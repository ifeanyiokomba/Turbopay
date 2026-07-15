/**
 * TurboCore — BillSwift Domain Service
 * =====================================
 *
 * Bill aggregation, reference validation, provider resolution, fee
 * calculation, bulk processing, receipts, and settlement tracking.
 *
 * Reuses TurboCore services (wallet, ledger, AML, KYC, audit, notifications)
 * and delegates bill fulfilment to the configured IBillPaymentProvider adapter.
 */

import { db } from "@/lib/db";
import { providers } from "@/lib/turbocore/providers/registry";
import { fees } from "@/lib/turbocore/fees";
import { executeProviderDebit } from "@/lib/turbopay/payments";
import { audit } from "@/lib/turbopay/audit";
import { nairaToKobo } from "@/lib/turbopay/money";
import { generateReference } from "@/lib/turbopay/reference";
import type { KycTier } from "@/lib/turbopay/types";
import type { BillProductCatalog } from "@/lib/turbocore/providers/interfaces";

class BillSwiftService {
  /** List all bill products from the active provider. */
  async listProducts(): Promise<BillProductCatalog[]> {
    const bp = await providers.billPayment();
    const result = await bp.listProducts();
    return result.ok && result.data ? result.data : [];
  }

  /** Validate a customer reference (meter/account/RRR) before payment. */
  async validate(input: { productCode: string; customer: string; meterType?: "PREPAID" | "POSTPAID" }) {
    const bp = await providers.billPayment();
    return bp.validate(input);
  }

  /**
   * Create a bulk bill-processing job (queue-based). Individual items are
   * processed by the background worker — see `processNextBulkItem` and the
   * `/api/cron/billswift-bulk` cron route.
   */
  async createBulkJob(userId: string, items: Array<{ productCode: string; customer: string; customerName?: string; amountNaira: number; meterType?: "PREPAID" | "POSTPAID" }>) {
    const reference = generateReference("BSBULK");
    const job = await db.billSwiftBulkJob.create({
      data: {
        userId, reference, totalItems: items.length, status: "PENDING",
        metadata: JSON.stringify({ itemCount: items.length }),
      },
    });
    await db.billSwiftBulkItem.createMany({
      data: items.map((item, i) => ({
        jobId: job.id, rowIndex: i, productCode: item.productCode, customer: item.customer,
        customerName: item.customerName ?? null, amountMinor: nairaToKobo(item.amountNaira),
        meterType: item.meterType ?? null, status: "PENDING",
      })),
    });
    await audit({ userId, action: "BILLSWIFT_BULK_CREATED", category: "BILL", metadata: { jobId: job.id, reference, itemCount: items.length } });
    return { jobId: job.id, reference };
  }

  /**
   * Process the next pending bulk item (called by the worker / cron).
   *
    * Picks the next PENDING item — across all jobs if `jobId` is omitted, or
    * within a single job if specified — and fulfils it through the
    * `executeProviderDebit` orchestrator:
   *
   *   1. Mark the item PROCESSING (so a concurrent caller cannot pick it up).
   *   2. Load the user + wallet; verify the wallet is ACTIVE and funded.
   *   3. Run AML `checkDebit` against the user's KYC tier.
   *   4. `executeProviderDebit` → atomic hold + provider call + confirm/reverse.
   *      - SUCCESS: item → SUCCESS (with providerRef + transactionId), the
   *        hold is confirmed (money stays debited), a `billPayment` side row
   *        is created, the parent job counters tick.
   *      - FAILURE: the orchestrator auto-reverses the hold (no funds
   *        stranded), item → FAILED with the error message, parent job
   *        failedCount ticks.
   *   5. If the parent job has no remaining PENDING items, mark it COMPLETED.
   *
   * Idempotent: only PENDING items are selected. A second call after a
   * SUCCESS/FAILED transition returns `{ processed: false }` because the
   * previously-processed item is no longer PENDING.
   *
   * Returns a structured result so the cron loop can collect errors + counts.
   */
  async processNextBulkItem(jobId?: string): Promise<{
    processed: boolean;
    reason?: string;
    itemId?: string;
    jobId?: string;
    success?: boolean;
    error?: string;
    transactionId?: string;
    providerRef?: string;
    newBalanceKobo?: number;
  }> {
    const item = await db.billSwiftBulkItem.findFirst({
      where: {
        status: "PENDING",
        job: { status: { in: ["PENDING", "PROCESSING"] } },
        ...(jobId ? { jobId } : {}),
      },
      orderBy: { rowIndex: "asc" },
      include: { job: { select: { userId: true, reference: true } } },
    });
    if (!item) return { processed: false, reason: "NO_PENDING_ITEMS" };

    // Reserve the item so a concurrent worker cannot pick it up. Mark the
    // parent job PROCESSING so admins can see it is in flight.
    await db.billSwiftBulkItem.update({ where: { id: item.id }, data: { status: "PROCESSING" } });
    await db.billSwiftBulkJob.update({ where: { id: item.jobId }, data: { status: "PROCESSING" } });

    try {
      const user = await db.user.findUnique({
        where: { id: item.job.userId },
        select: { id: true, kycTier: true, status: true },
      });
      if (!user) throw new Error("USER_NOT_FOUND");
      if (user.status !== "ACTIVE") throw new Error("USER_NOT_ACTIVE");

      const wallet = await db.wallet.findUnique({ where: { userId: user.id } });
      if (!wallet) throw new Error("USER_WALLET_NOT_FOUND");
      if (wallet.status !== "ACTIVE") throw new Error("WALLET_FROZEN");
      if (wallet.balanceKobo < item.amountMinor) throw new Error("INSUFFICIENT_FUNDS");

      // AML check now runs INSIDE the hold transaction (passed via the
      // `aml` field to executeProviderDebit below) — atomic with the debit,
      // closes the F6 race window. On AML block, executeProviderDebit throws
      // AmlBlockedError (code: "AML_BLOCKED"); the catch block below records
      // the error message on the bulk item, matching the prior behaviour.

      // Use the hold/confirm/reverse orchestrator. The provider-facing
      // reference is pre-generated so the adapter can use it
      // as an idempotency key (audit: was "PENDING" before the prior fix).
      const providerReference = generateReference("BSB");

      const result = await executeProviderDebit({
        userId: user.id,
        walletId: wallet.id,
        type: "BILL_UTILITY",
        refType: "BILL",
        amountKobo: item.amountMinor,
        description: `BillSwift Bulk — ${item.customer}`,
        counterpartyName: item.customerName ?? item.customer,
        counterpartyAccount: item.customer,
        provider: "billswift",
        metadata: {
          bulkJobId: item.jobId,
          bulkItemId: item.id,
          bulkJobReference: item.job.reference,
          productCode: item.productCode,
          providerReference,
        },
        aml: { userId: user.id, kycTier: user.kycTier as KycTier },
        sideModel: "billPayment",
        createSideRow: async (tx, transactionId) => {
          const row = await tx.billPayment.create({
            data: {
              userId: user.id,
              transactionId,
              category: "BILL_UTILITY",
              provider: "billswift",
              customer: item.customer,
              customerName: item.customerName ?? null,
              product: item.productCode,
              amountKobo: item.amountMinor,
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
            productCode: item.productCode,
            customer: item.customer,
            customerName: item.customerName ?? "",
            amountMinor: item.amountMinor,
            currency: "NGN",
            meterType: (item.meterType === "PREPAID" || item.meterType === "POSTPAID") ? item.meterType : undefined,
            reference: providerReference,
          });
          if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Bill payment failed");
          return {
            providerRef: r.data.providerRef,
            extra: { token: r.data.token, receiptNumber: r.data.receiptNumber },
          };
        },
      });

      // Success — record the providerRef + transactionId on the item.
      await db.billSwiftBulkItem.update({
        where: { id: item.id },
        data: {
          status: "SUCCESS",
          providerRef: result.providerRef,
          transactionId: result.transactionId,
        },
      });
      await db.billSwiftBulkJob.update({
        where: { id: item.jobId },
        data: { successCount: { increment: 1 }, processedItems: { increment: 1 } },
      });
      await audit({
        userId: user.id,
        action: "BILLSWIFT_BULK_ITEM_PROCESSED",
        category: "BILL",
        metadata: {
          jobId: item.jobId,
          itemId: item.id,
          providerRef: result.providerRef,
          transactionId: result.transactionId,
          amountMinor: item.amountMinor,
        },
      });

      await this.markJobCompleteIfDone(item.jobId);

      return {
        processed: true,
        itemId: item.id,
        jobId: item.jobId,
        success: true,
        transactionId: result.transactionId,
        providerRef: result.providerRef,
        newBalanceKobo: result.newBalanceKobo,
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "ERROR";
      // executeProviderDebit already auto-reversed the hold (if it reached the
      // provider call), so no funds are stranded here.
      await db.billSwiftBulkItem.update({
        where: { id: item.id },
        data: { status: "FAILED", error: message },
      });
      await db.billSwiftBulkJob.update({
        where: { id: item.jobId },
        data: { failedCount: { increment: 1 }, processedItems: { increment: 1 } },
      });
      await audit({
        userId: item.job.userId,
        action: "BILLSWIFT_BULK_ITEM_FAILED",
        category: "BILL",
        severity: "WARN",
        metadata: {
          jobId: item.jobId,
          itemId: item.id,
          error: message,
          amountMinor: item.amountMinor,
        },
      });

      await this.markJobCompleteIfDone(item.jobId);

      return {
        processed: true,
        itemId: item.id,
        jobId: item.jobId,
        success: false,
        error: message,
      };
    }
  }

  /**
   * If the parent job has no remaining PENDING items, mark it COMPLETED.
   * Called after every item processing attempt (success or failure).
   */
  private async markJobCompleteIfDone(jobId: string): Promise<void> {
    const remaining = await db.billSwiftBulkItem.count({
      where: { jobId, status: "PENDING" },
    });
    if (remaining === 0) {
      await db.billSwiftBulkJob.update({
        where: { id: jobId },
        data: { status: "COMPLETED" },
      });
    }
  }

  async createReceipt(input: { transactionId: string; userId: string; reference: string; type: string; amountMinor: number; currency?: string; counterparty?: string; token?: string; metadata?: Record<string, unknown> }) {
    return db.receipt.create({
      data: {
        transactionId: input.transactionId, userId: input.userId, reference: input.reference,
        type: input.type, amountMinor: input.amountMinor, currency: input.currency ?? "NGN",
        counterparty: input.counterparty ?? null, token: input.token ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
  }
}

export const billswift = new BillSwiftService();
