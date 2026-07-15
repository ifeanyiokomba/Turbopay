/**
 * TurboCore — Outbound International Transfer Service
 * ====================================================
 *
 * Handles sending international transfers: FX quote, debit user wallet,
 * call provider, create settlement record, notify, audit.
 *
 * Uses the hold-confirm-reverse pattern for financial safety.
 */

import { db } from "@/lib/db";
import { debitWallet } from "@/lib/turbopay/ledger";
import { createTransactionRecord } from "@/lib/turbopay/wallet";
import { audit } from "@/lib/turbopay/audit";
import { providers } from "@/lib/turbocore/providers/registry";
import { generateReference } from "@/lib/turbopay/reference";
import { fx } from "@/lib/turbocore/fx";
import { features } from "@/lib/turbocore/features";
import { checkDebit } from "@/lib/turbopay/aml";
import { transitionState } from "@/lib/turbopay/tx-state";
import type { Currency } from "@/lib/turbocore/types";
import { outbox } from "@/lib/turbocore/outbox";
import type { KycTier } from "@/lib/turbopay/types";

export interface SendIntlTransferInput {
  userId: string;
  walletId: string;
  kycTier: KycTier;
  sourceCurrency: Currency;
  destinationCurrency: Currency;
  amountMinor: number;
  beneficiary: {
    name: string;
    account?: string;
    bank?: string;
    country: string;
    routingCode?: string;
  };
  purpose: string;
}

export interface SendIntlTransferResult {
  success: boolean;
  transactionId?: string;
  reference?: string;
  providerRef?: string;
  quotedRate?: number;
  destinationAmountMinor?: number;
  feesMinor?: number;
  error?: string;
  errorCode?: string;
}

/**
 * Send an outbound international transfer.
 *
 * Flow:
 *   1. Validate feature flag is enabled
 *   2. Get FX quote for the currency pair
 *   3. AML check on the source amount
 *   4. Debit user wallet (hold pattern)
 *   5. Call international transfer provider
 *   6. On success: confirm + create settlement record
 *   7. On failure: reverse hold + mark failed
 *   8. Notify + audit
 */
export async function sendInternationalTransfer(
  input: SendIntlTransferInput
): Promise<SendIntlTransferResult> {
  const { userId, walletId, kycTier, sourceCurrency, destinationCurrency, amountMinor, beneficiary, purpose } = input;

  // 1. Feature flag check
  const intlEnabled = await features.isEnabled("turbopay.intl", userId);
  if (!intlEnabled) {
    return { success: false, error: "International transfers are not available", errorCode: "FEATURE_DISABLED" };
  }

  // 2. Get FX quote
  let quote;
  try {
    quote = await fx.getQuote(sourceCurrency, destinationCurrency, amountMinor, { userId });
  } catch (e: any) {
    return { success: false, error: e.message ?? "FX quote failed", errorCode: "FX_QUOTE_FAILED" };
  }

  const totalDebit = amountMinor + quote.platformFeeMinor;

  // 3. AML check
  const amlResult = await checkDebit(userId, walletId, totalDebit, kycTier);
  if (!amlResult.allowed) {
    return { success: false, error: amlResult.reason ?? "Transaction blocked by risk monitoring", errorCode: "AML_BLOCKED" };
  }

  // 4. Hold debit
  const reference = generateReference("INTL");
  let transactionId: string;
  let ledgerEntryId: string;

  try {
    const holdResult = await db.$transaction(async (tx) => {
      // Conditional debit
      const updated = await tx.wallet.updateMany({
        where: { id: walletId, status: "ACTIVE", balanceKobo: { gte: totalDebit } },
        data: { balanceKobo: { decrement: totalDebit }, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        const w = await tx.wallet.findUnique({ where: { id: walletId }, select: { balanceKobo: true, status: true } });
        if (!w) throw new Error("WALLET_NOT_FOUND");
        if (w.status !== "ACTIVE") throw new Error("WALLET_FROZEN");
        throw new Error("INSUFFICIENT_FUNDS");
      }

      const wallet = await tx.wallet.findUnique({ where: { id: walletId }, select: { balanceKobo: true } });

      // Ledger entry
      const entry = await tx.ledgerEntry.create({
        data: {
          walletId,
          entryType: "DEBIT",
          amountKobo: totalDebit,
          currency: sourceCurrency,
          refType: "TRANSFER",
          balanceAfterKobo: wallet!.balanceKobo,
          description: `International transfer to ${beneficiary.name} (${beneficiary.country})`,
          immutable: true,
        },
      });

      // Transaction record
      const txRec = await tx.transaction.create({
        data: {
          reference,
          userId,
          walletId,
          type: "TRANSFER_OUT",
          direction: "DEBIT",
          amountKobo: amountMinor,
          feeKobo: quote.platformFeeMinor,
          status: "PENDING",
          state: "INITIATED",
          counterpartyName: beneficiary.name,
          counterpartyAccount: beneficiary.account ?? null,
          counterpartyBank: beneficiary.bank ?? null,
          description: `International transfer to ${beneficiary.name} (${beneficiary.country})`,
          provider: "intl-transfer",
          metadata: JSON.stringify({
            sourceCurrency,
            destinationCurrency,
            destinationAmountMinor: quote.destinationAmountMinor,
            rate: quote.rate,
            feesMinor: quote.platformFeeMinor,
            purpose,
            ledgerEntryId: entry.id,
          }),
        },
      });

      return { transactionId: txRec.id, ledgerEntryId: entry.id, balanceAfter: wallet!.balanceKobo };
    }, { timeout: 15000 });

    transactionId = holdResult.transactionId;
    ledgerEntryId = holdResult.ledgerEntryId;
  } catch (e: any) {
    return { success: false, error: e.message ?? "Failed to hold funds", errorCode: e.message };
  }

  // 5. Call provider
  await transitionState(transactionId, "HOLD_POSTED").catch(() => null);
  await transitionState(transactionId, "PROVIDER_CALLED").catch(() => null);

  try {
    const intlProvider = await providers.internationalTransfer();
    const providerResult = await intlProvider.send({
      sourceCurrency,
      destinationCurrency,
      amountMinor,
      beneficiary: {
        name: beneficiary.name,
        account: beneficiary.account,
        bank: beneficiary.bank,
        country: beneficiary.country,
        routingCode: beneficiary.routingCode,
      },
      purpose,
      reference,
    });

    if (!providerResult.ok || !providerResult.data) {
      throw new Error(providerResult.error?.message ?? "Provider rejected the transfer");
    }

    // Capture data outside closure for TypeScript narrowing
    const providerData = providerResult.data;

    // 6. Confirm
    await db.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: transactionId },
        data: {
          status: "SUCCESS",
          providerRef: providerResult.providerRef ?? null,
          metadata: JSON.stringify({
            sourceCurrency,
            destinationCurrency,
            destinationAmountMinor: quote.destinationAmountMinor,
            rate: quote.rate,
            feesMinor: quote.platformFeeMinor,
            purpose,
            ledgerEntryId,
            providerRef: providerResult.providerRef,
          }),
        },
      });

      // Create settlement record
      await tx.settlement.create({
        data: {
          providerRef: providerResult.providerRef ?? reference,
          provider: "intl-transfer",
          type: "INTL_TRANSFER",
          settlementCurrency: destinationCurrency,
          settlementAmountMinor: quote.destinationAmountMinor,
          status: providerData.status === "SUCCESS" ? "SETTLED" : "PENDING",
          reference,
          metadata: JSON.stringify({
            rate: quote.rate,
            feesMinor: quote.platformFeeMinor,
            beneficiary,
          }),
        },
      });
    }, { timeout: 15000 });

    await transitionState(transactionId, "SETTLED").catch(() => null);

    // 7. Notify + audit
    const notifier = await providers.notification();
    notifier.send({
      to: "", // Will be resolved from user profile
      channel: "SMS",
      template: "intl.sent",
      variables: {
        amount: amountMinor / 100,
        currency: sourceCurrency,
        beneficiary: beneficiary.name,
        country: beneficiary.country,
      },
      reference,
    }).catch(() => null);

    await audit({
      userId,
      action: "INTL_TRANSFER_SENT",
      category: "WALLET",
      severity: "INFO",
      metadata: {
        reference,
        transactionId,
        providerRef: providerResult.providerRef,
        sourceCurrency,
        destinationCurrency,
        amountMinor,
        destinationAmountMinor: quote.destinationAmountMinor,
        rate: quote.rate,
        feesMinor: quote.platformFeeMinor,
        beneficiary,
      },
    });

    return {
      success: true,
      transactionId,
      reference,
      providerRef: providerResult.providerRef,
      quotedRate: quote.rate,
      destinationAmountMinor: quote.destinationAmountMinor,
      feesMinor: quote.platformFeeMinor,
    };
  } catch (e: any) {
    // 8. Reverse hold on failure
    await db.$transaction(async (tx) => {
      // Reverse the ledger entry
      const originalEntry = await tx.ledgerEntry.findUnique({ where: { id: ledgerEntryId } });
      if (originalEntry) {
        const oppositeType = originalEntry.entryType === "DEBIT" ? "CREDIT" : "DEBIT";
        if (oppositeType === "CREDIT") {
          await tx.wallet.updateMany({
            where: { id: walletId, status: "ACTIVE" },
            data: { balanceKobo: { increment: totalDebit }, version: { increment: 1 } },
          });
        }
        await tx.ledgerEntry.create({
          data: {
            walletId,
            entryType: oppositeType,
            amountKobo: totalDebit,
            currency: sourceCurrency,
            refType: "REVERSAL",
            balanceAfterKobo: (await tx.wallet.findUnique({ where: { id: walletId } }))!.balanceKobo,
            description: `Reversal: International transfer failed - ${e.message}`,
            immutable: true,
          },
        });
      }

      await tx.transaction.update({
        where: { id: transactionId },
        data: {
          status: "FAILED",
          metadata: JSON.stringify({
            sourceCurrency,
            destinationCurrency,
            destinationAmountMinor: quote.destinationAmountMinor,
            rate: quote.rate,
            feesMinor: quote.platformFeeMinor,
            purpose,
            ledgerEntryId,
            reversalReason: e.message,
          }),
        },
      });
    }, { timeout: 15000 });

    await transitionState(transactionId, "REVERSED").catch(() => null);

    await audit({
      userId,
      action: "INTL_TRANSFER_FAILED",
      category: "WALLET",
      severity: "WARN",
      metadata: { reference, transactionId, error: e.message },
    });

    return { success: false, error: e.message ?? "Transfer failed", errorCode: "PROVIDER_ERROR" };
  }
}
