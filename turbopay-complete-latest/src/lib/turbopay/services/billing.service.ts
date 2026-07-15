/**
 * Turbopay Service Layer — BillingService.
 * ========================================
 *
 * Wraps every bill-payment flow (airtime, data, electricity, utilities).
 * Debit methods route through `debitPipeline` (PIN → AML → hold → provider →
 * confirm/reverse → audit → notify → cashback). Validate methods just call
 * `providers.billPayment().validate()`.
 *
 * Extracted from:
 *   - src/app/api/airtime/route.ts            → buyAirtime
 *   - src/app/api/data/route.ts               → buyData + getDataPlans passthrough
 *   src/app/api/bills/electricity/route.ts    → validateElectricity / payElectricity
 *   src/app/api/bills/utilities/route.ts      → validateUtility   / payUtility
 *
 * Behavior is preserved bit-for-bit from the original routes.
 */

import { db } from "@/lib/db";
import { providers } from "@/lib/turbocore/providers/registry";
import { getDataPlans, DISCOS, BILL_PRODUCTS, type DataPlan } from "@/lib/turbocore/catalog";
import { fees } from "@/lib/turbocore/fees";
import { notify } from "@/lib/turbocore/notifications";
import { nairaToKobo } from "@/lib/turbopay/money";
import { generateReference } from "@/lib/turbopay/reference";
import { getIdempotentResponse, startIdempotency, completeIdempotency } from "@/lib/turbopay/idempotency";
import { debitPipeline } from "./pipeline";
import { ServiceError } from "./types";
import type {
  BuyAirtimeInput,
  BuyAirtimeResult,
  BuyDataInput,
  BuyDataResult,
  ValidateElectricityInput,
  PayElectricityInput,
  PayElectricityResult,
  ValidateUtilityInput,
  PayUtilityInput,
  PayUtilityResult,
} from "./types";

class BillingService {
  // ─── Airtime ────────────────────────────────────────────────────────

  async buyAirtime(input: BuyAirtimeInput): Promise<BuyAirtimeResult> {
    const { user, phoneNumber, network, amountNaira, pin, ip, idemKey } = input;
    const amountKobo = nairaToKobo(amountNaira);

    // Idempotency check
    if (idemKey) {
      const cached = await getIdempotentResponse<BuyAirtimeResult>(idemKey);
      if (cached.hit) return cached.body;
      const started = await startIdempotency(idemKey, "billing.buyAirtime", user.id);
      if (!started) throw new ServiceError("IDEMPOTENCY_INFLIGHT", "Request already processing", 409);
    }

    const wallet = await db.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) throw new ServiceError("WALLET_NOT_FOUND", "Wallet not found", 404);
    if (wallet.status !== "ACTIVE") throw new ServiceError("WALLET_FROZEN", "Wallet is frozen", 403);

    const feeResult = await fees.calculate("turbopay", "AIRTIME", amountKobo, { kycTier: user.kycTier });
    const feeKobo = feeResult.feeMinor;
    const totalDebit = amountKobo + feeKobo;

    if (wallet.balanceKobo < totalDebit) throw new ServiceError("INSUFFICIENT_FUNDS", "Insufficient funds", 400);

    const providerReference = generateReference("BAX");

    const result = await debitPipeline({
      user,
      walletId: wallet.id,
      amountKobo: totalDebit,
      type: "AIRTIME",
      refType: "AIRTIME",
      description: `${network} airtime — ${phoneNumber}`,
      counterpartyName: network,
      counterpartyAccount: phoneNumber,
      provider: "baxi",
      pin,
      kycTier: user.kycTier,
      metadata: { network, phoneNumber, providerReference, feeKobo },
      sideModel: "airtimeData",
      createSideRow: async (tx, transactionId) => {
        const row = await tx.airtimeDataPurchase.create({
          data: {
            userId: user.id,
            transactionId,
            type: "AIRTIME",
            phoneNumber,
            network,
            amountKobo: totalDebit,
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
          productCode: `AIRTIME:${network}`,
          customer: phoneNumber,
          customerName: network,
          amountMinor: amountKobo,
          currency: "NGN",
          reference: providerReference,
        });
        if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Airtime purchase failed");
        return { providerRef: r.data.providerRef };
      },
      auditAction: "AIRTIME_PURCHASE",
      auditMetadata: { network, phoneNumber },
      ip,
      notificationTitle: "Airtime Purchase",
      notificationMessage: `${network} airtime — ${phoneNumber} · ₦${amountNaira.toLocaleString()} · Ref: <ref>`,
      cashbackCategory: "AIRTIME",
    });

    const output = {
      ok: true as const,
      reference: result.reference,
      providerRef: result.providerRef,
      newBalanceKobo: result.newBalanceKobo,
    };

    if (idemKey) await completeIdempotency(idemKey, 200, output).catch(() => null);
    return output;
  }

  // ─── Data ───────────────────────────────────────────────────────────

  /** Static passthrough — returns the data-plan catalog (optionally filtered). */
  getDataPlans(network?: string): DataPlan[] {
    return getDataPlans(network);
  }

  /** Static passthrough — returns the electricity DISCOS catalog. */
  getDiscos() {
    return DISCOS;
  }

  /** Static passthrough — returns the bill-products catalog. */
  getBillProducts() {
    return BILL_PRODUCTS;
  }

  async buyData(input: BuyDataInput): Promise<BuyDataResult> {
    const { user, phoneNumber, planId, pin, ip, idemKey } = input;

    // Idempotency check
    if (idemKey) {
      const cached = await getIdempotentResponse<BuyDataResult>(idemKey);
      if (cached.hit) return cached.body;
      const started = await startIdempotency(idemKey, "billing.buyData", user.id);
      if (!started) throw new ServiceError("IDEMPOTENCY_INFLIGHT", "Request already processing", 409);
    }

    const plan = getDataPlans().find((p) => p.id === planId);
    if (!plan) throw new ServiceError("PLAN_NOT_FOUND", "Selected data plan is not available", 404);

    const wallet = await db.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) throw new ServiceError("WALLET_NOT_FOUND", "Wallet not found", 404);
    if (wallet.status !== "ACTIVE") throw new ServiceError("WALLET_FROZEN", "Wallet is frozen", 403);

    const feeResult = await fees.calculate("turbopay", "DATA", plan.amountKobo, { kycTier: user.kycTier });
    const feeKobo = feeResult.feeMinor;
    const totalDebit = plan.amountKobo + feeKobo;

    if (wallet.balanceKobo < totalDebit) throw new ServiceError("INSUFFICIENT_FUNDS", "Insufficient funds", 400);

    const providerReference = generateReference("BAX");

    const result = await debitPipeline({
      user,
      walletId: wallet.id,
      amountKobo: totalDebit,
      type: "DATA",
      refType: "DATA",
      description: `${plan.name} data — ${phoneNumber}`,
      counterpartyName: plan.network,
      counterpartyAccount: phoneNumber,
      provider: "baxi",
      pin,
      kycTier: user.kycTier,
      metadata: { network: plan.network, plan: plan.name, size: plan.size, providerReference, feeKobo },
      sideModel: "airtimeData",
      createSideRow: async (tx, transactionId) => {
        const row = await tx.airtimeDataPurchase.create({
          data: {
            userId: user.id,
            transactionId,
            type: "DATA",
            phoneNumber,
            network: plan.network,
            plan: plan.name,
            amountKobo: totalDebit,
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
          productCode: `DATA:${plan.id}`,
          customer: phoneNumber,
          customerName: plan.network,
          amountMinor: plan.amountKobo,
          currency: "NGN",
          reference: providerReference,
        });
        if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Data purchase failed");
        return { providerRef: r.data.providerRef };
      },
      auditAction: "DATA_PURCHASE",
      auditMetadata: { plan: plan.name },
      ip,
      notificationTitle: "Data Purchase",
      notificationMessage: `${plan.name} data — ${phoneNumber} · ₦${(plan.amountKobo / 100).toLocaleString()} · Ref: <ref>`,
      cashbackCategory: "DATA",
    });

    const output = {
      ok: true as const,
      reference: result.reference,
      providerRef: result.providerRef,
      newBalanceKobo: result.newBalanceKobo,
    };

    if (idemKey) await completeIdempotency(idemKey, 200, output).catch(() => null);
    return output;
  }

  // ─── Electricity ────────────────────────────────────────────────────

  async validateElectricity(input: ValidateElectricityInput) {
    const bp = await providers.billPayment();
    const r = await bp.validate({
      productCode: input.discoCode,
      customer: input.meterNumber,
      meterType: input.meterType,
    });
    if (!r.ok || !r.data) {
      throw new ServiceError("PROVIDER_ERROR", r.error?.message ?? "Validation failed", 502);
    }
    return r.data;
  }

  async payElectricity(input: PayElectricityInput): Promise<PayElectricityResult> {
    const { user, discoCode, discoName, meterNumber, meterType, customerName, amountNaira, pin, ip, idemKey } = input;
    const amountKobo = nairaToKobo(amountNaira);

    // Idempotency check
    if (idemKey) {
      const cached = await getIdempotentResponse<PayElectricityResult>(idemKey);
      if (cached.hit) return cached.body;
      const started = await startIdempotency(idemKey, "billing.payElectricity", user.id);
      if (!started) throw new ServiceError("IDEMPOTENCY_INFLIGHT", "Request already processing", 409);
    }

    const wallet = await db.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) throw new ServiceError("WALLET_NOT_FOUND", "Wallet not found", 404);
    if (wallet.status !== "ACTIVE") throw new ServiceError("WALLET_FROZEN", "Wallet is frozen", 403);

    const feeResult = await fees.calculate("turbopay", "BILL_ELECTRICITY", amountKobo, { kycTier: user.kycTier });
    const feeKobo = feeResult.feeMinor;
    const totalDebit = amountKobo + feeKobo;

    if (wallet.balanceKobo < totalDebit) throw new ServiceError("INSUFFICIENT_FUNDS", "Insufficient funds", 400);

    const providerReference = generateReference("BAX");

    // The electricity notification message must include the prepaid token,
    // which is only known after the provider call. We tell the pipeline to
    // skip its own notification and send a custom one below (preserving the
    // original route's notification shape exactly).
    const result = await debitPipeline({
      user,
      walletId: wallet.id,
      amountKobo: totalDebit,
      type: "BILL_ELECTRICITY",
      refType: "BILL",
      description: `${discoName} electricity — ${meterNumber}`,
      counterpartyName: discoName,
      counterpartyAccount: meterNumber,
      provider: "baxi",
      pin,
      kycTier: user.kycTier,
      metadata: { disco: discoName, meterNumber, meterType, providerReference, feeKobo },
      sideModel: "billPayment",
      createSideRow: async (tx, transactionId) => {
        const row = await tx.billPayment.create({
          data: {
            userId: user.id,
            transactionId,
            category: "ELECTRICITY",
            provider: "baxi",
            customer: meterNumber,
            customerName,
            product: `${discoName} ${meterType}`,
            amountKobo: totalDebit,
            feeKobo,
            status: "PENDING",
            reference: providerReference,
          },
        });
        return row.id;
      },
      providerCall: async () => {
        const bp = await providers.billPayment();
        const r = await bp.pay({
          productCode: discoCode,
          customer: meterNumber,
          customerName,
          amountMinor: amountKobo,
          currency: "NGN",
          meterType,
          reference: providerReference,
        });
        if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Electricity payment failed");
        return { providerRef: r.data.providerRef, extra: { token: r.data.token } };
      },
      auditAction: "BILL_ELECTRICITY",
      auditMetadata: { disco: discoName, meter: meterNumber },
      ip,
      notificationTitle: "Electricity Payment",
      notificationMessage: `${discoName} electricity — ${meterNumber} · ₦${amountNaira.toLocaleString()} · Ref: <ref>`,
      skipNotification: true,
      cashbackCategory: "BILL_ELECTRICITY",
    });

    // Surface the prepaid token (if any) from the transaction metadata —
    // executeProviderDebit stores the providerCall's `extra` field there via
    // confirmHold's extraMetadata merge.
    const txRow = await db.transaction.findUnique({
      where: { id: result.transactionId },
      select: { metadata: true },
    });
    const meta = txRow?.metadata ? (JSON.parse(txRow.metadata) as Record<string, unknown>) : {};
    const token: string | null = meta?.token ? String(meta.token) : null;

    // Fire-and-forget in-app notification with the reference AND the prepaid
    // token (matches the original route's notification shape exactly).
    notify
      .sendInApp({
        userId: user.id,
        type: "TRANSACTION",
        title: "Electricity Payment",
        message: `${discoName} electricity — ${meterNumber} · ₦${amountNaira.toLocaleString()} · Ref: ${result.reference}${token ? ` · Token: ${token}` : ""}`,
        actionUrl: "/history",
        actionLabel: "View receipt",
      })
      .catch(() => null);

    const output = {
      ok: true as const,
      reference: result.reference,
      providerRef: result.providerRef,
      token,
      newBalanceKobo: result.newBalanceKobo,
    };

    if (idemKey) await completeIdempotency(idemKey, 200, output).catch(() => null);
    return output;
  }

  // ─── Utilities ──────────────────────────────────────────────────────

  async validateUtility(input: ValidateUtilityInput) {
    const bp = await providers.billPayment();
    const r = await bp.validate({ productCode: input.code, customer: input.customer });
    if (!r.ok || !r.data) {
      throw new ServiceError("PROVIDER_ERROR", r.error?.message ?? "Validation failed", 502);
    }
    return r.data;
  }

  async payUtility(input: PayUtilityInput): Promise<PayUtilityResult> {
    const { user, code, customer, customerName, productName, category, amountNaira, pin, ip, idemKey } = input;
    const amountKobo = nairaToKobo(amountNaira);

    // Idempotency check
    if (idemKey) {
      const cached = await getIdempotentResponse<PayUtilityResult>(idemKey);
      if (cached.hit) return cached.body;
      const started = await startIdempotency(idemKey, "billing.payUtility", user.id);
      if (!started) throw new ServiceError("IDEMPOTENCY_INFLIGHT", "Request already processing", 409);
    }

    const wallet = await db.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) throw new ServiceError("WALLET_NOT_FOUND", "Wallet not found", 404);
    if (wallet.status !== "ACTIVE") throw new ServiceError("WALLET_FROZEN", "Wallet is frozen", 403);

    const feeResult = await fees.calculate("turbopay", "BILL_UTILITY", amountKobo, { kycTier: user.kycTier });
    const feeKobo = feeResult.feeMinor;
    const totalDebit = amountKobo + feeKobo;

    if (wallet.balanceKobo < totalDebit) throw new ServiceError("INSUFFICIENT_FUNDS", "Insufficient funds", 400);

    const providerReference = generateReference("BAX");

    const result = await debitPipeline({
      user,
      walletId: wallet.id,
      amountKobo: totalDebit,
      type: "BILL_UTILITY",
      refType: "BILL",
      description: `${productName} — ${customer}`,
      counterpartyName: productName,
      counterpartyAccount: customer,
      provider: "baxi",
      pin,
      kycTier: user.kycTier,
      metadata: { category, customer, product: productName, providerReference, feeKobo },
      sideModel: "billPayment",
      createSideRow: async (tx, transactionId) => {
        const row = await tx.billPayment.create({
          data: {
            userId: user.id,
            transactionId,
            category,
            provider: "baxi",
            customer,
            customerName,
            product: productName,
            amountKobo: totalDebit,
            feeKobo,
            status: "PENDING",
            reference: providerReference,
          },
        });
        return row.id;
      },
      providerCall: async () => {
        const bp = await providers.billPayment();
        const r = await bp.pay({
          productCode: code,
          customer,
          customerName,
          amountMinor: amountKobo,
          currency: "NGN",
          reference: providerReference,
        });
        if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Bill payment failed");
        return { providerRef: r.data.providerRef };
      },
      auditAction: "BILL_UTILITY",
      auditMetadata: { product: productName },
      ip,
      notificationTitle: "Bill Payment",
      notificationMessage: `${productName} — ${customer} · ₦${amountNaira.toLocaleString()} · Ref: <ref>`,
      cashbackCategory: "BILL_UTILITY",
    });

    const output = {
      ok: true as const,
      reference: result.reference,
      providerRef: result.providerRef,
      newBalanceKobo: result.newBalanceKobo,
    };

    if (idemKey) await completeIdempotency(idemKey, 200, output).catch(() => null);
    return output;
  }
}

export const billingService = new BillingService();
