import { db } from "@/lib/db";
import { getLedgerBalance, getCurrencyWalletBalance } from "@/lib/turbopay/ledger";
import { generateAccountNumber, generateReference } from "@/lib/turbopay/money";
import { providers } from "@/lib/turbocore/providers/registry";
import { logger } from "@/lib/turbocore/logger";
import { getDefaultCurrency, getSupportedCurrencies } from "@/lib/turbocore/config/country-currency";
import type {
  Direction,
  TransactionView,
  TxStatus,
  TxType,
  WalletView,
} from "@/lib/turbopay/types";

/**
 * WALLET SERVICE — orchestration over the ledger + transactions.
 *
 * Two wallet systems:
 *   - Wallet (primary): one per user, stores `balanceKobo`, currency defaults to NGN.
 *     Used by all existing domestic flows. Never modified — backward compatible.
 *   - CurrencyWallet: one per (user, currency). Stores `balanceMinor`.
 *     Created alongside the primary wallet at signup. Used by multi-currency flows.
 */

/** Ensure a user has a wallet + an active virtual funding account. */
export async function ensureWallet(userId: string, accountName: string, country?: string) {
  const defaultCurrency = country ? getDefaultCurrency(country) : "NGN";
  let wallet = await db.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    wallet = await db.wallet.create({ data: { userId, balanceKobo: 0, currency: defaultCurrency, status: "ACTIVE" } });
  }
  // Ensure CurrencyWallet rows for all supported currencies except the primary wallet's currency.
  await ensureCurrencyWallets(userId, wallet.currency);
  let vaccount = await db.virtualAccount.findFirst({
    where: { userId, status: "ACTIVE" },
  });
  if (!vaccount) {
    // Call through the TurboCore provider registry. When Monnify (or another
    // provider) is configured as PRIMARY, this creates a REAL reserved account
    // via the provider's API. When no provider is configured, it falls back to
    // the mock adapter (deterministic, no network). If the real provider call
    // fails (e.g. missing contract code), we fall back to a local account so
    // the user can still use the app.
    let accountNumber = generateAccountNumber();
    let accountNameFinal = accountName;
    let bankName = "Turbopay MFB";
    let bankCode = "50515";
    let providerRef = generateReference("MNF");
    let providerName = "mock";

    try {
      const ctx = { product: "turbopay" as const, country };
      const va = await providers.virtualAccount(ctx);
      providerName = va.name.replace("mock-", "").replace("production-", "");
      const result = await va.createReservedAccount(accountName, userId, ctx);
      if (result.ok && result.data) {
        accountNumber = result.data.accountNumber;
        accountNameFinal = result.data.accountName;
        bankName = result.data.bankName;
        bankCode = result.data.bankCode;
        providerRef = result.data.providerRef;
      }
    } catch (e) {
      // Provider call failed (e.g. missing contract code, network error).
      // Fall back to a locally-generated account so the user isn't blocked.
      logger.warn("wallet.virtual_account_fallback", { error: e instanceof Error ? e.message : String(e) });
    }

    vaccount = await db.virtualAccount.create({
      data: {
        userId,
        accountNumber,
        accountName: accountNameFinal,
        bankName,
        bankCode,
        provider: providerName,
        providerRef,
        status: "ACTIVE",
      },
    });
  }
  return { wallet, vaccount };
}

/**
 * Ensure CurrencyWallet rows exist for all supported currencies except
 * the primary wallet's currency. Idempotent — safe to call on every login.
 */
export async function ensureCurrencyWallets(userId: string, excludeCurrency?: string): Promise<void> {
  const currencies = getSupportedCurrencies().filter((c) => c !== excludeCurrency);
  for (const currency of currencies) {
    await db.currencyWallet.upsert({
      where: { userId_currency: { userId, currency } },
      create: { userId, currency },
      update: {}, // no-op if already exists
    });
  }
}

/** Get all CurrencyWallets for a user. */
export async function getCurrencyWallets(userId: string) {
  return db.currencyWallet.findMany({
    where: { userId },
    orderBy: { currency: "asc" },
  });
}

/** Get a specific CurrencyWallet for a user. */
export async function getCurrencyWallet(userId: string, currency: string) {
  return db.currencyWallet.findUnique({
    where: { userId_currency: { userId, currency } },
  });
}

export async function getWalletView(userId: string): Promise<WalletView | null> {
  const wallet = await db.wallet.findUnique({ where: { userId } });
  if (!wallet) return null;
  const ledgerBalanceKobo = await getLedgerBalance(wallet.id);
  return {
    id: wallet.id,
    balanceKobo: wallet.balanceKobo,
    currency: wallet.currency,
    status: wallet.status as WalletView["status"],
    ledgerBalanceKobo,
  };
}

export interface CreateTxInput {
  userId: string;
  walletId: string;
  type: TxType;
  direction: Direction;
  amountKobo: number;
  feeKobo?: number;
  status?: TxStatus;
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
  counterpartyBank?: string | null;
  description?: string | null;
  provider?: string | null;
  providerRef?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function createTransactionRecord(input: CreateTxInput) {
  return db.transaction.create({
    data: {
      reference: generateReference("TP"),
      userId: input.userId,
      walletId: input.walletId,
      type: input.type,
      direction: input.direction,
      amountKobo: input.amountKobo,
      feeKobo: input.feeKobo ?? 0,
      status: input.status ?? "SUCCESS",
      counterpartyName: input.counterpartyName ?? null,
      counterpartyAccount: input.counterpartyAccount ?? null,
      counterpartyBank: input.counterpartyBank ?? null,
      description: input.description ?? null,
      provider: input.provider ?? null,
      providerRef: input.providerRef ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export function toTxView(t: {
  id: string;
  reference: string;
  type: string;
  direction: string;
  amountKobo: number;
  feeKobo: number;
  status: string;
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  counterpartyBank: string | null;
  description: string | null;
  provider: string | null;
  createdAt: Date;
}): TransactionView {
  return {
    id: t.id,
    reference: t.reference,
    type: t.type as TxType,
    direction: t.direction as Direction,
    amountKobo: t.amountKobo,
    feeKobo: t.feeKobo,
    status: t.status as TxStatus,
    counterpartyName: t.counterpartyName,
    counterpartyAccount: t.counterpartyAccount,
    counterpartyBank: t.counterpartyBank,
    description: t.description,
    provider: t.provider,
    createdAt: t.createdAt.toISOString(),
  };
}

/** Resolve an internal transfer recipient by phone, email, or Turbopay account number. */
export async function resolveTurbopayRecipient(identifier: string) {
  const id = identifier.trim();
  // Turbopay virtual account numbers are 10 digits starting with our range.
  const byAccount = await db.virtualAccount.findFirst({
    where: { accountNumber: id, status: "ACTIVE" },
    include: { user: true },
  });
  if (byAccount) return { user: byAccount.user, wallet: await db.wallet.findUnique({ where: { userId: byAccount.userId } })!, vaccount: byAccount };
  const byEmail = await db.user.findUnique({ where: { email: id.toLowerCase() }, include: { wallet: true } });
  if (byEmail?.wallet) return { user: byEmail, wallet: byEmail.wallet, vaccount: null };
  const byPhone = await db.user.findUnique({ where: { phone: id }, include: { wallet: true } });
  if (byPhone?.wallet) return { user: byPhone, wallet: byPhone.wallet, vaccount: null };
  return null;
}
