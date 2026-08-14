/**
 * TurboCore — International Settlement Engine
 * ===========================================
 *
 * Settles an inbound international receiving event: FX conversion, fee split,
 * ledger credit to the beneficiary wallet, notifications, audit, reporting.
 *
 * ARCHITECTURAL — inactive until a licensed partner is configured. All flows
 * use mock providers. No live integrations.
 */

import { db } from "@/lib/db";
import { creditWalletInTx } from "@/lib/turbopay/ledger";
import { createTransactionRecord } from "@/lib/turbopay/wallet";
import { audit } from "@/lib/turbopay/audit";
import { providers } from "@/lib/turbocore/providers/registry";
import type { IntlReceivingEvent } from "@/lib/turbocore/providers/interfaces";
import { KYC_LIMITS } from "@/lib/turbopay/types";
import { generateReference } from "@/lib/turbopay/reference";
import { fx } from "@/lib/turbocore/fx";
import type { Currency } from "@/lib/turbocore/types";

export interface SettlementResult {
  settled: boolean;
  walletId?: string;
  creditedAmountMinor?: number;
  reason?: string;
}

/**
 * Settle an inbound international payment:
 *   1. Resolve the beneficiary wallet by virtual account number.
 *   2. Check KYC balance cap.
 *   3. Credit the wallet (atomic, conditional).
 *   4. Create the user-facing transaction record.
 *   5. Record the settlement for reconciliation.
 *   6. Notify + audit.
 *
 * Idempotent on providerRef — a duplicate webhook never double-credits.
 */
export async function settleIntlReceiving(event: IntlReceivingEvent): Promise<SettlementResult> {
  // Idempotency: a settlement with this providerRef must not be processed twice.
  const existing = await db.transaction.findFirst({
    where: { provider: "intl-receiving", providerRef: event.providerRef },
  });
  if (existing) {
    return { settled: false, reason: "DUPLICATE_WEBHOOK", walletId: existing.walletId };
  }

  // 1. Resolve beneficiary wallet via virtual account.
  const va = await db.virtualAccount.findFirst({
    where: { accountNumber: event.beneficiaryAccount, status: "ACTIVE" },
    include: { user: true },
  });
  if (!va) return { settled: false, reason: "ACCOUNT_NOT_FOUND" };

  const wallet = await db.wallet.findUnique({ where: { userId: va.userId } });
  if (!wallet) return { settled: false, reason: "WALLET_NOT_FOUND" };
  if (wallet.status !== "ACTIVE") {
    await audit({
      userId: va.userId,
      action: "INTL_RECEIVING_HELD_FROZEN",
      category: "AML",
      severity: "WARN",
      metadata: { providerRef: event.providerRef, amount: event.destinationAmountMinor },
    });
    return { settled: false, reason: "WALLET_FROZEN_HELD" };
  }

  // 2. KYC balance cap.
  const tierCap = KYC_LIMITS[va.user.kycTier as 1 | 2 | 3]?.balanceKobo ?? Number.MAX_SAFE_INTEGER;
  if (wallet.balanceKobo + event.destinationAmountMinor > tierCap) {
    await audit({
      userId: va.userId,
      action: "INTL_RECEIVING_HELD_KYC_CAP",
      category: "AML",
      severity: "WARN",
      metadata: { providerRef: event.providerRef, balance: wallet.balanceKobo, cap: tierCap },
    });
    return { settled: false, reason: "KYC_BALANCE_CAP_EXCEEDED" };
  }

  // 3+4. ATOMIC: ledger credit + transaction record commit in ONE transaction.
  //    A crash between the two would leave a credited wallet with no history.
  const { credit, tx } = await db.$transaction(async (t) => {
    const credit = await creditWalletInTx(t, wallet.id, event.destinationAmountMinor, "FUNDING", {
      description: `International transfer from ${event.sender.name} (${event.sender.country})`,
    });
    const tx = await createTransactionRecord(
      {
        userId: va.userId,
        walletId: wallet.id,
        type: "FUNDING",
        direction: "CREDIT",
        amountKobo: event.destinationAmountMinor,
        description: `International transfer from ${event.sender.name} (${event.sender.country})`,
        counterpartyName: event.sender.name,
        counterpartyAccount: event.beneficiaryAccount,
        counterpartyBank: "International",
        provider: "intl-receiving",
        providerRef: event.providerRef,
        metadata: {
          sourceCurrency: event.sourceCurrency,
          sourceAmountMinor: event.sourceAmountMinor,
          destinationCurrency: event.destinationCurrency,
          destinationAmountMinor: event.destinationAmountMinor,
          rate: event.rate,
          feesMinor: event.feesMinor,
          senderCountry: event.sender.country,
          ledgerEntryId: credit.ledgerEntryId,
        },
      },
      t
    );
    return { credit, tx };
  }, { timeout: 15000 });

  // 5. The WebhookRegistry already manages the WebhookEvent lifecycle
  //    (creates it in process() before dispatching). Do NOT create a
  //    duplicate here — it would violate the @@unique([provider, providerRef])
  //    constraint and abort the settlement.

  // 6. Notify + audit.
  const notifier = await providers.notification();
  notifier
    .send({
      to: va.user.phone ?? "",
      channel: "SMS",
      template: "intl.received",
      variables: { amount: event.destinationAmountMinor / 100, currency: event.destinationCurrency, sender: event.sender.name },
      reference: tx.reference,
    })
    .catch(() => null);

  await audit({
    userId: va.userId,
    action: "INTL_TRANSFER_RECEIVED",
    category: "WALLET",
    severity: "INFO",
    metadata: {
      providerRef: event.providerRef,
      reference: tx.reference,
      sourceCurrency: event.sourceCurrency,
      sourceAmountMinor: event.sourceAmountMinor,
      destinationAmountMinor: event.destinationAmountMinor,
      rate: event.rate,
    },
  });

  return { settled: true, walletId: wallet.id, creditedAmountMinor: event.destinationAmountMinor };
}

/**
 * Get an FX quote — delegates to the TurboCore FX Engine
 * (`src/lib/turbocore/fx/index.ts`), which enforces the currency-pair
 * whitelist, applies the configured spread, caches rate snapshots, and
 * audits. Kept here as a thin compatibility shim for existing callers.
 */
export async function getFxQuote(from: string, to: string, amountMinor: number) {
  return fx.getQuote(from as Currency, to as Currency, amountMinor);
}
