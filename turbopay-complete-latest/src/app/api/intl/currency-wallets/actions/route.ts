/**
 * Currency Wallet Actions API
 * ============================
 *
 * POST /api/intl/currency-wallets/actions — Perform actions on currency wallets
 *
 * Actions:
 * - fund: Fund a currency wallet from NGN wallet
 * - withdraw: Withdraw from a currency wallet to NGN wallet
 * - exchange: Convert between currency wallets (with FX)
 * - transfer: Transfer between same-currency wallets
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { requireUser } from "@/lib/turbopay/auth";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { db } from "@/lib/db";
import { creditCurrencyWallet, debitCurrencyWallet, transferBetweenCurrencyWallets } from "@/lib/turbopay/ledger";
import { fx } from "@/lib/turbocore/fx";
import { audit } from "@/lib/turbopay/audit";

const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "KES", "GHS", "ZAR"];

export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401); }

  const limited = await rateLimit(req, { key: "currency-wallet-actions", limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  let body;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { action, walletId, amount, toWalletId, fromCurrency, toCurrency } = body as {
    action: string;
    walletId?: string;
    amount?: number;
    toWalletId?: string;
    fromCurrency?: string;
    toCurrency?: string;
  };

  if (!action) return errorJson("action is required", 400);

  try {
    switch (action) {
      case "fund":
        return await handleFund(user.id, walletId, amount);
      case "withdraw":
        return await handleWithdraw(user.id, walletId, amount);
      case "exchange":
        return await handleExchange(user.id, fromCurrency, toCurrency, amount);
      case "transfer":
        return await handleTransfer(user.id, walletId, toWalletId, amount);
      default:
        return errorJson(`Unknown action: ${action}`, 400);
    }
  } catch (e: any) {
    return errorJson(e.message ?? "Action failed", 400);
  }
}

// ─── Fund Currency Wallet ───────────────────────────────────

async function handleFund(userId: string, walletId: string | undefined, amount: number | undefined) {
  if (!walletId) return errorJson("walletId is required", 400);
  if (!amount || amount <= 0) return errorJson("amount must be positive", 400);

  const wallet = await db.currencyWallet.findFirst({ where: { id: walletId, userId } });
  if (!wallet) return errorJson("Currency wallet not found", 404);

  const ngWallet = await db.wallet.findFirst({ where: { userId } });
  if (!ngWallet) return errorJson("NGN wallet not found", 404);

  const amountMinor = Math.round(amount * 100);
  const desc = `Fund ${wallet.currency} wallet`;

  // FX conversion: NGN → target currency
  const quote = await fx.getQuote("NGN" as any, wallet.currency as any, amountMinor, { userId });

  // Debit NGN wallet via currency wallet ledger (using NGN wallet)
  await debitCurrencyWallet(ngWallet.id, amountMinor, "NGN", "TRANSFER", { description: desc, userId });

  // Credit currency wallet
  await creditCurrencyWallet(walletId, quote.destinationAmountMinor, wallet.currency, "FUNDING", { description: desc });

  await audit({ userId, action: "CURRENCY_WALLET_FUNDED", category: "WALLET", metadata: {
    walletId, currency: wallet.currency, amount, destAmount: quote.destinationAmountMinor / 100, rate: quote.rate,
  }});

  const updated = await db.currencyWallet.findUnique({ where: { id: walletId } });
  return json({ data: {
    success: true,
    debited: amount,
    credited: quote.destinationAmountMinor / 100,
    currency: wallet.currency,
    rate: quote.rate,
    fee: quote.platformFeeMinor / 100,
    newBalance: (updated?.balanceMinor ?? 0) / 100,
  }});
}

// ─── Withdraw from Currency Wallet ──────────────────────────

async function handleWithdraw(userId: string, walletId: string | undefined, amount: number | undefined) {
  if (!walletId) return errorJson("walletId is required", 400);
  if (!amount || amount <= 0) return errorJson("amount must be positive", 400);

  const wallet = await db.currencyWallet.findFirst({ where: { id: walletId, userId } });
  if (!wallet) return errorJson("Currency wallet not found", 404);

  const ngWallet = await db.wallet.findFirst({ where: { userId } });
  if (!ngWallet) return errorJson("NGN wallet not found", 404);

  const amountMinor = Math.round(amount * 100);
  const desc = `Withdraw ${wallet.currency} to NGN`;

  const quote = await fx.getQuote(wallet.currency as any, "NGN" as any, amountMinor, { userId });

  await debitCurrencyWallet(walletId, amountMinor, wallet.currency, "TRANSFER", { description: desc, userId });
  await creditCurrencyWallet(ngWallet.id, quote.destinationAmountMinor, "NGN", "FUNDING", { description: desc });

  await audit({ userId, action: "CURRENCY_WALLET_WITHDRAWN", category: "WALLET", metadata: {
    walletId, currency: wallet.currency, amount, nairaAmount: quote.destinationAmountMinor / 100, rate: quote.rate,
  }});

  return json({ data: {
    success: true,
    debited: amount,
    credited: quote.destinationAmountMinor / 100,
    currency: wallet.currency,
    rate: quote.rate,
    fee: quote.platformFeeMinor / 100,
  }});
}

// ─── Exchange Between Currencies ────────────────────────────

async function handleExchange(userId: string, fromCurrency: string | undefined, toCurrency: string | undefined, amount: number | undefined) {
  if (!fromCurrency || !toCurrency) return errorJson("fromCurrency and toCurrency are required", 400);
  if (!SUPPORTED_CURRENCIES.includes(fromCurrency) || !SUPPORTED_CURRENCIES.includes(toCurrency)) {
    return errorJson("Unsupported currency", 400);
  }
  if (fromCurrency === toCurrency) return errorJson("Cannot exchange same currency", 400);
  if (!amount || amount <= 0) return errorJson("amount must be positive", 400);

  const fromWallet = await db.currencyWallet.findFirst({ where: { userId, currency: fromCurrency } });
  const toWallet = await db.currencyWallet.findFirst({ where: { userId, currency: toCurrency } });
  if (!fromWallet) return errorJson(`${fromCurrency} wallet not found`, 404);
  if (!toWallet) return errorJson(`${toCurrency} wallet not found. Create it first.`, 404);

  const amountMinor = Math.round(amount * 100);
  const desc = `Exchange ${fromCurrency}→${toCurrency}`;

  const quote = await fx.getQuote(fromCurrency as any, toCurrency as any, amountMinor, { userId });

  await debitCurrencyWallet(fromWallet.id, amountMinor, fromCurrency, "TRANSFER", { description: desc, userId });
  await creditCurrencyWallet(toWallet.id, quote.destinationAmountMinor, toCurrency, "FUNDING", { description: desc });

  await audit({ userId, action: "CURRENCY_EXCHANGE", category: "FX", metadata: {
    fromCurrency, toCurrency, amount, received: quote.destinationAmountMinor / 100, rate: quote.rate,
  }});

  return json({ data: {
    success: true,
    debited: amount,
    debitedCurrency: fromCurrency,
    credited: quote.destinationAmountMinor / 100,
    creditedCurrency: toCurrency,
    rate: quote.rate,
    fee: quote.platformFeeMinor / 100,
  }});
}

// ─── Transfer Between Same-Currency Wallets ─────────────────

async function handleTransfer(userId: string, fromWalletId: string | undefined, toWalletId: string | undefined, amount: number | undefined) {
  if (!fromWalletId || !toWalletId) return errorJson("fromWalletId and toWalletId are required", 400);
  if (!amount || amount <= 0) return errorJson("amount must be positive", 400);

  const fromWallet = await db.currencyWallet.findFirst({ where: { id: fromWalletId, userId } });
  if (!fromWallet) return errorJson("Source wallet not found", 404);

  const amountMinor = Math.round(amount * 100);

  await transferBetweenCurrencyWallets(fromWalletId, toWalletId, amountMinor, fromWallet.currency, "TRANSFER", { description: `Transfer ${fromWallet.currency}` });

  await audit({ userId, action: "CURRENCY_WALLET_TRANSFER", category: "TRANSFER", metadata: {
    fromWalletId, toWalletId, currency: fromWallet.currency, amount,
  }});

  return json({ data: {
    success: true,
    amount,
    currency: fromWallet.currency,
  }});
}
