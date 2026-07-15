import { db } from "@/lib/db";
import { creditWallet, creditCurrencyWallet } from "@/lib/turbopay/ledger";
import { createTransactionRecord } from "@/lib/turbopay/wallet";
import { audit } from "@/lib/turbopay/audit";
import { kycLimits } from "@/lib/turbocore/config/kyc-limits";
import { getCurrencySymbol } from "@/lib/turbocore/config/country-currency";

/**
 * FUNDING ORCHESTRATION — called by the Monnify webhook handler and by the
 * demo "simulate funding" flow. Idempotent on providerRef: a duplicate
 * webhook never double-credits the wallet.
 *
 * When `currency` is provided and differs from the primary wallet's currency,
 * the funding is credited to the matching CurrencyWallet instead. When
 * `currency` is absent or matches the primary wallet, behavior is unchanged.
 */
export async function processFunding(input: {
  accountNumber: string;
  amountKobo: number;
  providerRef: string;
  paymentReference: string;
  description?: string;
  currency?: string;
  provider?: string;
}): Promise<{ credited: boolean; transactionId: string | null; reason?: string }> {
  const provider = input.provider ?? "monnify";
  const va = await db.virtualAccount.findFirst({
    where: { accountNumber: input.accountNumber, status: "ACTIVE" },
    include: { user: true },
  });
  if (!va) return { credited: false, transactionId: null, reason: "NO_VIRTUAL_ACCOUNT" };

  // Idempotency: a funding with this providerRef must not be processed twice.
  const existing = await db.transaction.findFirst({
    where: { userId: va.userId, provider, providerRef: input.providerRef },
  });
  if (existing) {
    return { credited: false, transactionId: existing.id, reason: "DUPLICATE_WEBHOOK" };
  }

  const wallet = await db.wallet.findUnique({ where: { userId: va.userId } });
  if (!wallet) return { credited: false, transactionId: null, reason: "WALLET_NOT_FOUND" };

  // Determine target: primary wallet or a CurrencyWallet.
  const isMultiCurrency = input.currency && input.currency !== wallet.currency;
  const targetCurrency = input.currency ?? wallet.currency;
  const currencySymbol = getCurrencySymbol(targetCurrency);

  if (isMultiCurrency) {
    // Multi-currency funding path: credit the CurrencyWallet.
    const currencyWallet = await db.currencyWallet.findUnique({
      where: { userId_currency: { userId: va.userId, currency: targetCurrency } },
    });
    if (!currencyWallet) return { credited: false, transactionId: null, reason: "CURRENCY_WALLET_NOT_FOUND" };

    if (currencyWallet.status !== "ACTIVE") {
      await db.amlFlag.create({
        data: {
          userId: va.userId,
          rule: "FUNDING_TO_FROZEN_WALLET",
          severity: "HIGH",
          description: `Incoming ${targetCurrency} funding of ${currencySymbol}${(input.amountKobo / 100).toLocaleString()} to a FROZEN currency wallet held for review`,
        },
      });
      return { credited: false, transactionId: null, reason: "WALLET_FROZEN_HELD" };
    }

    const credit = await creditCurrencyWallet(currencyWallet.id, input.amountKobo, targetCurrency, "FUNDING", {
      description: input.description ?? `Wallet funding via virtual account (${targetCurrency})`,
    });

    const tx = await createTransactionRecord({
      userId: va.userId,
      walletId: wallet.id,
      type: "FUNDING",
      direction: "CREDIT",
      amountKobo: input.amountKobo,
      description: input.description ?? `Wallet funding via virtual account (${targetCurrency})`,
      counterpartyName: va.bankName,
      counterpartyAccount: va.accountNumber,
      counterpartyBank: va.bankName,
      provider,
      providerRef: input.providerRef,
      metadata: { paymentReference: input.paymentReference, ledgerEntryId: credit.ledgerEntryId, currency: targetCurrency },
    });

    await audit({
      userId: va.userId,
      action: "WALLET_FUNDED",
      category: "WALLET",
      severity: "INFO",
      metadata: { amountKobo: input.amountKobo, currency: targetCurrency, providerRef: input.providerRef, reference: tx.reference },
    });

    return { credited: true, transactionId: tx.id };
  }

  // Standard NGN (primary wallet) funding path — unchanged from original.
  if (wallet.status !== "ACTIVE") {
    await db.amlFlag.create({
      data: {
        userId: va.userId,
        rule: "FUNDING_TO_FROZEN_WALLET",
        severity: "HIGH",
        description: `Incoming funding of ${currencySymbol}${(input.amountKobo / 100).toLocaleString()} to a FROZEN wallet held for review`,
      },
    });
    await audit({
      userId: va.userId,
      action: "FUNDING_HELD_FROZEN_WALLET",
      category: "AML",
      severity: "WARN",
      metadata: { amountKobo: input.amountKobo, providerRef: input.providerRef },
    });
    return { credited: false, transactionId: null, reason: "WALLET_FROZEN_HELD" };
  }

  // KYC balance cap — CBN Tiered-KYC requires maximum wallet balances per tier.
  const limits = await kycLimits.getLimits(va.user.kycTier as 1 | 2 | 3, "turbopay");
  const tierCap = limits.balanceKobo ?? Number.MAX_SAFE_INTEGER;
  if (wallet.balanceKobo + input.amountKobo > tierCap) {
    await db.amlFlag.create({
      data: {
        userId: va.userId,
        rule: "KYC_BALANCE_CAP_EXCEEDED",
        severity: "MEDIUM",
        description: `Funding of ${currencySymbol}${(input.amountKobo / 100).toLocaleString()} would exceed Tier ${va.user.kycTier} balance cap (${currencySymbol}${(tierCap / 100).toLocaleString()}). Held for review.`,
      },
    });
    await audit({
      userId: va.userId,
      action: "FUNDING_HELD_KYC_CAP",
      category: "AML",
      severity: "WARN",
      metadata: { amountKobo: input.amountKobo, balanceKobo: wallet.balanceKobo, tierCap, providerRef: input.providerRef },
    });
    return { credited: false, transactionId: null, reason: "KYC_BALANCE_CAP_EXCEEDED" };
  }

  const credit = await creditWallet(wallet.id, input.amountKobo, "FUNDING", {
    description: input.description ?? "Wallet funding via virtual account",
  });

  const tx = await createTransactionRecord({
    userId: va.userId,
    walletId: wallet.id,
    type: "FUNDING",
    direction: "CREDIT",
    amountKobo: input.amountKobo,
    description: input.description ?? "Wallet funding via virtual account",
    counterpartyName: va.bankName,
    counterpartyAccount: va.accountNumber,
    counterpartyBank: va.bankName,
    provider,
    providerRef: input.providerRef,
    metadata: { paymentReference: input.paymentReference, ledgerEntryId: credit.ledgerEntryId },
  });

  await audit({
    userId: va.userId,
    action: "WALLET_FUNDED",
    category: "WALLET",
    severity: "INFO",
    metadata: { amountKobo: input.amountKobo, providerRef: input.providerRef, reference: tx.reference },
  });

  return { credited: true, transactionId: tx.id };
}
