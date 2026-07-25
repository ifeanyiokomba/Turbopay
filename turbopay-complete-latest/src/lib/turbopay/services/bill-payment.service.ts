/**
 * Turbopay Service Layer — BillPaymentService.
 * ==============================================
 *
 * Unified bill payment service that routes to the best provider (Baxi,
 * Remita, Quickteller, BillSwift) based on the biller's provider.
 *
 * CRITICAL FIX: The original route (bills/pay/route.ts) debited the wallet
 * via raw `db.wallet.update({ balanceKobo: { decrement } })` WITHOUT:
 *   - Ledger entries (balance desync with ledger)
 *   - Hold/confirm pattern (no atomicity guarantee)
 *   - Rollback on failure (debit stuck if provider call fails)
 *
 * This service routes through `debitPipeline` which provides:
 *   - PIN verification with lockout
 *   - AML checks inside the hold transaction
 *   - Atomic hold + provider call + confirm-or-reverse
 *   - Ledger entries for every balance mutation
 *   - Audit logging and notifications
 *
 * Extracted from:
 *   - src/app/api/bills/pay/route.ts → validate, pay
 */

import { db } from "@/lib/db";
import { providers } from "@/lib/turbocore/providers/registry";
import { audit } from "@/lib/turbopay/audit";
import { generateReference } from "@/lib/turbopay/reference";
import { getIdempotentResponse, startIdempotency, completeIdempotency } from "@/lib/turbopay/idempotency";
import { debitPipeline } from "./pipeline";
import { ServiceError } from "./types";
import type { SessionUser } from "@/lib/turbopay/types";

// ─── Input/Output Types ─────────────────────────────────────────────────

export interface ValidateBillCustomerInput {
  provider: string;
  billerId: string;
  customerRef: string;
}

export interface ValidateBillCustomerResult {
  valid: boolean;
  customerName?: string;
  message?: string;
}

export interface PayBillInput {
  user: SessionUser;
  billerId: string;
  billerName: string;
  provider: string;
  customerRef: string;
  amountKobo: number;
  category: string;
  fixedAmount?: number;
  pin: string;
  ip?: string;
  idemKey?: string;
}

export interface PayBillResult {
  ok: true;
  reference: string;
  status: "COMPLETED";
  amountKobo: number;
  billerName: string;
  customerName?: string;
  customerRef: string;
  newBalanceKobo: number;
}

// ─── Service ────────────────────────────────────────────────────────────

class BillPaymentService {
  /**
   * Validate a customer reference against a provider.
   * Simulates provider-specific validation (meter number, RRR, etc.).
   */
  async validateCustomer(input: ValidateBillCustomerInput): Promise<ValidateBillCustomerResult> {
    const { provider, billerId, customerRef } = input;

    switch (provider) {
      case "baxi":
        if (customerRef.length >= 8) {
          return { valid: true, customerName: "Customer Name (Simulated via Baxi)" };
        }
        return { valid: false, message: "Invalid meter number" };

      case "remita":
        if (customerRef.length >= 10) {
          return { valid: true, customerName: "Customer Name (Simulated via Remita)" };
        }
        return { valid: false, message: "Invalid RRR number" };

      case "quickteller":
        if (customerRef.length >= 4) {
          return { valid: true, customerName: "Customer Name (Simulated via Quickteller)" };
        }
        return { valid: false, message: "Invalid customer reference" };

      case "billswift":
        if (customerRef.length >= 4) {
          return { valid: true, customerName: "Customer Name (Simulated via BillSwift)" };
        }
        return { valid: false, message: "Invalid customer reference" };

      default:
        return { valid: false, message: `Unknown provider: ${provider}` };
    }
  }

  /**
   * Process a unified bill payment.
   *
   * Routes through `debitPipeline` for:
   * - PIN verification with lockout
   * - AML checks
   * - Atomic hold → provider call → confirm-or-reverse
   * - Ledger entries for every balance mutation
   * - Audit logging and notifications
   */
  async pay(input: PayBillInput): Promise<PayBillResult> {
    const { user, billerId, billerName, provider, customerRef, amountKobo, category, fixedAmount, pin, ip, idemKey } = input;

    // Idempotency check
    if (idemKey) {
      const cached = await getIdempotentResponse<PayBillResult>(idemKey);
      if (cached.hit) return cached.body;
      const started = await startIdempotency(idemKey, "billPayment.pay", user.id);
      if (!started) throw new ServiceError("IDEMPOTENCY_INFLIGHT", "Request already processing", 409);
    }

    // Validate customer reference
    const validationResult = await this.validateCustomer({ provider, billerId, customerRef });
    if (!validationResult.valid) {
      throw new ServiceError("VALIDATION_FAILED", validationResult.message || "Customer validation failed", 400);
    }

    const finalAmount = fixedAmount ?? amountKobo;
    if (!finalAmount || finalAmount <= 0) {
      throw new ServiceError("INVALID_AMOUNT", "Amount must be a positive number", 400);
    }

    // Route through the debit pipeline (PIN → AML → hold → provider → confirm)
    const providerReference = generateReference("BIL");

    const result = await debitPipeline({
      user,
      walletId: "", // Will be resolved by the pipeline from user.id
      amountKobo: finalAmount,
      type: "BILL_ELECTRICITY", // Generic bill type — category in metadata differentiates
      refType: "BILL",
      description: `${billerName} — ${customerRef}`,
      counterpartyName: billerName,
      counterpartyAccount: customerRef,
      provider,
      pin,
      kycTier: user.kycTier,
      metadata: {
        billerId,
        billerName,
        provider,
        customerRef,
        category,
        customerName: validationResult.customerName,
        providerReference,
      },
      sideModel: "billPayment",
      createSideRow: async (tx, transactionId) => {
        const row = await tx.billPayment.create({
          data: {
            userId: user.id,
            transactionId,
            category: category?.toUpperCase() || "BILL",
            provider,
            customer: customerRef,
            customerName: validationResult.customerName || "Unknown",
            product: billerName,
            amountKobo: finalAmount,
            feeKobo: 0,
            status: "PENDING",
            reference: providerReference,
          },
        });
        return row.id;
      },
      providerCall: async () => {
        // Route to the correct provider based on the biller's provider
        const bp = await providers.billPayment();
        const r = await bp.pay({
          productCode: billerId,
          customer: customerRef,
          customerName: validationResult.customerName || "Unknown",
          amountMinor: finalAmount,
          currency: "NGN",
          reference: providerReference,
        });
        if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Bill payment failed");
        return { providerRef: r.data.providerRef };
      },
      auditAction: "BILL_PAYMENT",
      auditMetadata: { billerName, provider, category, customerRef },
      ip,
      notificationTitle: "Bill Payment",
      notificationMessage: `${billerName} — ${customerRef} · ₦${(finalAmount / 100).toLocaleString()} · Ref: <ref>`,
    });

    const output: PayBillResult = {
      ok: true,
      reference: result.reference,
      status: "COMPLETED",
      amountKobo: finalAmount,
      billerName,
      customerName: validationResult.customerName,
      customerRef,
      newBalanceKobo: result.newBalanceKobo,
    };

    if (idemKey) await completeIdempotency(idemKey, 200, output).catch(() => null);
    return output;
  }
}

export const billPaymentService = new BillPaymentService();
