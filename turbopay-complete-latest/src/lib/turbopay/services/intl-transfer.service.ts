/**
 * Turbopay Service Layer — IntlTransferService.
 * ================================================
 *
 * Read-side international transfer queries (detail + history).
 * Extracted from:
 *   - src/app/api/intl/transfer/route.ts  → detail
 *   - src/app/api/intl/history/route.ts   → history
 *   - src/app/api/intl/beneficiaries/route.ts → beneficiaries
 *   - src/app/api/intl/currency-wallets/route.ts → currencyWallets
 */

import { db } from "@/lib/db";
import { creditCurrencyWallet, debitCurrencyWallet, transferBetweenCurrencyWallets } from "@/lib/turbopay/ledger";
import { fx } from "@/lib/turbocore/fx";
import { audit } from "@/lib/turbopay/audit";
import { ServiceError } from "./types";

const STATE_LABELS: Record<string, string> = {
  CREATED: "Transfer Created",
  INITIATED: "Initiated",
  PIN_VERIFIED: "PIN Verified",
  AML_CHECKED: "Compliance Check Passed",
  HOLD_POSTED: "Funds Held",
  PROVIDER_CALLED: "Sent to Provider",
  SETTLED: "Settled",
  REVERSED: "Reversed",
  TIMEOUT: "Timed Out",
  INTL_TRANSFER_SENT: "Provider Processing",
  INTL_TRANSFER_FAILED: "Provider Rejected",
};

class IntlTransferService {
  /**
   * Get detailed transfer info with state history and settlement.
   */
  async detail(userId: string, params: { id?: string; reference?: string }) {
    const { id, reference } = params;
    if (!id && !reference) throw new ServiceError("MISSING_PARAM", "Missing id or reference", 422);

    const where: Record<string, unknown> = { userId, provider: "intl-transfer" };
    if (id) where.id = id;
    if (reference) where.reference = reference;

    const tx = await db.transaction.findFirst({ where });
    if (!tx) throw new ServiceError("TRANSFER_NOT_FOUND", "Transfer not found", 404);

    const meta = tx.metadata ? JSON.parse(tx.metadata) : {};

    const stateTransitions = await db.auditLog.findMany({
      where: {
        userId,
        action: { in: ["TX_STATE_TRANSITION", "INTL_TRANSFER_SENT", "INTL_TRANSFER_FAILED"] },
        metadata: { contains: tx.reference },
      },
      orderBy: { createdAt: "asc" },
      select: { action: true, createdAt: true, metadata: true },
    });

    const settlement = await db.settlement.findFirst({ where: { reference: tx.reference } });

    const timeline = stateTransitions.map((log) => {
      const logMeta = log.metadata ? JSON.parse(log.metadata) : {};
      return {
        state: logMeta.to || log.action,
        timestamp: log.createdAt,
        label: STATE_LABELS[logMeta.to || log.action] || logMeta.to || log.action,
      };
    });

    if (timeline.length === 0 || timeline[0]?.state !== "INITIATED") {
      timeline.unshift({ state: "CREATED", timestamp: tx.createdAt, label: "Transfer Created" });
    }

    return {
      id: tx.id,
      reference: tx.reference,
      status: tx.status,
      state: tx.state,
      amountKobo: tx.amountKobo,
      feeKobo: tx.feeKobo,
      counterpartyName: tx.counterpartyName,
      counterpartyAccount: tx.counterpartyAccount,
      counterpartyBank: tx.counterpartyBank,
      description: tx.description,
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt,
      feeBreakdown: {
        sourceCurrency: meta.sourceCurrency,
        destinationCurrency: meta.destinationCurrency,
        exchangeRate: meta.rate,
        fxMarginBps: meta.fxMarginBps,
        platformFeeMinor: meta.feesMinor,
        destinationAmountMinor: meta.destinationAmountMinor,
      },
      settlement: settlement ? {
        status: settlement.status,
        settledAt: settlement.settledAt,
        settlementCurrency: settlement.settlementCurrency,
        settlementAmountMinor: settlement.settlementAmountMinor,
      } : null,
      timeline,
    };
  }

  /**
   * List international transfer history with cursor pagination.
   */
  async history(userId: string, params: { status?: string; limit?: number; cursor?: string }) {
    const { status, limit = 50, cursor } = params;

    const where: Record<string, unknown> = { userId, provider: "intl-transfer" };
    if (status) where.status = status;

    const transfers = await db.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = transfers.length > limit;
    const items = hasMore ? transfers.slice(0, limit) : transfers;

    return { items, nextCursor: hasMore ? items[items.length - 1]?.id : null };
  }

  /**
   * List user's international transfer beneficiaries.
   */
  async beneficiaries(userId: string) {
    return db.internationalBeneficiary.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * List user's currency wallets. Auto-creates defaults if none exist.
   */
  async currencyWallets(userId: string) {
    const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "KES", "GHS", "ZAR"];

    let wallets = await db.currencyWallet.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });

    if (wallets.length === 0) {
      wallets = await Promise.all(
        SUPPORTED_CURRENCIES.map((currency) =>
          db.currencyWallet.create({ data: { userId, currency } })
        )
      );
    }

    return wallets;
  }

  /**
   * Create a currency wallet on demand.
   */
  async createCurrencyWallet(userId: string, currency: string) {
    const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "KES", "GHS", "ZAR"];
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw new ServiceError("UNSUPPORTED_CURRENCY", `Unsupported currency. Supported: ${SUPPORTED_CURRENCIES.join(", ")}`, 422);
    }

    const existing = await db.currencyWallet.findFirst({ where: { userId, currency } });
    if (existing) return existing;

    return db.currencyWallet.create({ data: { userId, currency } });
  }

  /**
   * Update a currency wallet status.
   */
  async updateCurrencyWallet(userId: string, id: string, data: { status?: string }) {
    const wallet = await db.currencyWallet.findFirst({ where: { id, userId } });
    if (!wallet) throw new ServiceError("WALLET_NOT_FOUND", "Wallet not found", 404);

    if (data.status && ["ACTIVE", "FROZEN", "CLOSED"].includes(data.status)) {
      await db.currencyWallet.update({ where: { id }, data: { status: data.status } });
    }

    return db.currencyWallet.findUnique({ where: { id } });
  }

  /**
   * Create a new international beneficiary.
   */
  async createBeneficiary(userId: string, data: {
    name: string;
    country: string;
    bankName?: string;
    accountNumber?: string;
    swiftCode?: string;
    routingNumber?: string;
    mobileWallet?: string;
    nickname?: string;
    currency?: string;
  }) {
    return db.internationalBeneficiary.create({
      data: { ...data, userId, currency: data.currency ?? "USD" },
    });
  }

  /**
   * Delete an international beneficiary.
   */
  async deleteBeneficiary(userId: string, id: string) {
    const beneficiary = await db.internationalBeneficiary.findFirst({ where: { id, userId } });
    if (!beneficiary) throw new ServiceError("BENEFICIARY_NOT_FOUND", "Beneficiary not found", 404);
    await db.internationalBeneficiary.delete({ where: { id } });
  }

  /**
   * Update a beneficiary (favourite, nickname).
   */
  async updateBeneficiary(userId: string, id: string, data: { isFavourite?: boolean; nickname?: string }) {
    const beneficiary = await db.internationalBeneficiary.findFirst({ where: { id, userId } });
    if (!beneficiary) throw new ServiceError("BENEFICIARY_NOT_FOUND", "Beneficiary not found", 404);
    return db.internationalBeneficiary.update({ where: { id }, data });
  }

  // ─── Currency Wallet Actions ─────────────────────────────────────────

  /**
   * Fund a currency wallet from NGN wallet.
   */
  async fundCurrencyWallet(userId: string, walletId: string, amount: number) {
    const wallet = await db.currencyWallet.findFirst({ where: { id: walletId, userId } });
    if (!wallet) throw new ServiceError("WALLET_NOT_FOUND", "Currency wallet not found", 404);

    const ngWallet = await db.wallet.findFirst({ where: { userId } });
    if (!ngWallet) throw new ServiceError("NGN_WALLET_NOT_FOUND", "NGN wallet not found", 404);

    const amountMinor = Math.round(amount * 100);
    const desc = `Fund ${wallet.currency} wallet`;

    const quote = await fx.getQuote("NGN" as any, wallet.currency as any, amountMinor, { userId });
    await debitCurrencyWallet(ngWallet.id, amountMinor, "NGN", "TRANSFER", { description: desc, userId });
    await creditCurrencyWallet(walletId, quote.destinationAmountMinor, wallet.currency, "FUNDING", { description: desc });

    await audit({ userId, action: "CURRENCY_WALLET_FUNDED", category: "WALLET", metadata: {
      walletId, currency: wallet.currency, amount, destAmount: quote.destinationAmountMinor / 100, rate: quote.rate,
    }});

    const updated = await db.currencyWallet.findUnique({ where: { id: walletId } });
    return {
      success: true, debited: amount, credited: quote.destinationAmountMinor / 100,
      currency: wallet.currency, rate: quote.rate, fee: quote.platformFeeMinor / 100,
      newBalance: (updated?.balanceMinor ?? 0) / 100,
    };
  }

  /**
   * Withdraw from a currency wallet to NGN wallet.
   */
  async withdrawCurrencyWallet(userId: string, walletId: string, amount: number) {
    const wallet = await db.currencyWallet.findFirst({ where: { id: walletId, userId } });
    if (!wallet) throw new ServiceError("WALLET_NOT_FOUND", "Currency wallet not found", 404);

    const ngWallet = await db.wallet.findFirst({ where: { userId } });
    if (!ngWallet) throw new ServiceError("NGN_WALLET_NOT_FOUND", "NGN wallet not found", 404);

    const amountMinor = Math.round(amount * 100);
    const desc = `Withdraw ${wallet.currency} to NGN`;

    const quote = await fx.getQuote(wallet.currency as any, "NGN" as any, amountMinor, { userId });
    await debitCurrencyWallet(walletId, amountMinor, wallet.currency, "TRANSFER", { description: desc, userId });
    await creditCurrencyWallet(ngWallet.id, quote.destinationAmountMinor, "NGN", "FUNDING", { description: desc });

    await audit({ userId, action: "CURRENCY_WALLET_WITHDRAWN", category: "WALLET", metadata: {
      walletId, currency: wallet.currency, amount, nairaAmount: quote.destinationAmountMinor / 100, rate: quote.rate,
    }});

    return {
      success: true, debited: amount, credited: quote.destinationAmountMinor / 100,
      currency: wallet.currency, rate: quote.rate, fee: quote.platformFeeMinor / 100,
    };
  }

  /**
   * Exchange between currency wallets.
   */
  async exchangeCurrency(userId: string, fromCurrency: string, toCurrency: string, amount: number) {
    if (!SUPPORTED_CURRENCIES.includes(fromCurrency) || !SUPPORTED_CURRENCIES.includes(toCurrency)) {
      throw new ServiceError("UNSUPPORTED_CURRENCY", "Unsupported currency", 400);
    }
    if (fromCurrency === toCurrency) throw new ServiceError("SAME_CURRENCY", "Cannot exchange same currency", 400);

    const fromWallet = await db.currencyWallet.findFirst({ where: { userId, currency: fromCurrency } });
    const toWallet = await db.currencyWallet.findFirst({ where: { userId, currency: toCurrency } });
    if (!fromWallet) throw new ServiceError("WALLET_NOT_FOUND", `${fromCurrency} wallet not found`, 404);
    if (!toWallet) throw new ServiceError("WALLET_NOT_FOUND", `${toCurrency} wallet not found. Create it first.`, 404);

    const amountMinor = Math.round(amount * 100);
    const desc = `Exchange ${fromCurrency}→${toCurrency}`;

    const quote = await fx.getQuote(fromCurrency as any, toCurrency as any, amountMinor, { userId });
    await debitCurrencyWallet(fromWallet.id, amountMinor, fromCurrency, "TRANSFER", { description: desc, userId });
    await creditCurrencyWallet(toWallet.id, quote.destinationAmountMinor, toCurrency, "FUNDING", { description: desc });

    await audit({ userId, action: "CURRENCY_EXCHANGE", category: "FX", metadata: {
      fromCurrency, toCurrency, amount, received: quote.destinationAmountMinor / 100, rate: quote.rate,
    }});

    return {
      success: true, debited: amount, debitedCurrency: fromCurrency,
      credited: quote.destinationAmountMinor / 100, creditedCurrency: toCurrency,
      rate: quote.rate, fee: quote.platformFeeMinor / 100,
    };
  }

  /**
   * Transfer between same-currency wallets.
   */
  async transferCurrencyWallet(userId: string, fromWalletId: string, toWalletId: string, amount: number) {
    const fromWallet = await db.currencyWallet.findFirst({ where: { id: fromWalletId, userId } });
    if (!fromWallet) throw new ServiceError("WALLET_NOT_FOUND", "Source wallet not found", 404);

    const amountMinor = Math.round(amount * 100);
    await transferBetweenCurrencyWallets(fromWalletId, toWalletId, amountMinor, fromWallet.currency, "TRANSFER", { description: `Transfer ${fromWallet.currency}` });

    await audit({ userId, action: "CURRENCY_WALLET_TRANSFER", category: "TRANSFER", metadata: {
      fromWalletId, toWalletId, currency: fromWallet.currency, amount,
    }});

    return { success: true, amount, currency: fromWallet.currency };
  }
}

const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "KES", "GHS", "ZAR"];

export const intlTransferService = new IntlTransferService();
