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
 *
 * MIGRATED: Now delegates to intlTransferService.
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { requireUser } from "@/lib/turbopay/auth";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { intlTransferService } from "@/lib/turbopay/services/intl-transfer.service";
import { ServiceError } from "@/lib/turbopay/services/types";

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
    let result;
    switch (action) {
      case "fund":
        if (!walletId) return errorJson("walletId is required", 400);
        if (!amount || amount <= 0) return errorJson("amount must be positive", 400);
        result = await intlTransferService.fundCurrencyWallet(user.id, walletId, amount);
        break;
      case "withdraw":
        if (!walletId) return errorJson("walletId is required", 400);
        if (!amount || amount <= 0) return errorJson("amount must be positive", 400);
        result = await intlTransferService.withdrawCurrencyWallet(user.id, walletId, amount);
        break;
      case "exchange":
        if (!fromCurrency || !toCurrency) return errorJson("fromCurrency and toCurrency are required", 400);
        if (!amount || amount <= 0) return errorJson("amount must be positive", 400);
        result = await intlTransferService.exchangeCurrency(user.id, fromCurrency, toCurrency, amount);
        break;
      case "transfer":
        if (!walletId || !toWalletId) return errorJson("fromWalletId and toWalletId are required", 400);
        if (!amount || amount <= 0) return errorJson("amount must be positive", 400);
        result = await intlTransferService.transferCurrencyWallet(user.id, walletId, toWalletId, amount);
        break;
      default:
        return errorJson(`Unknown action: ${action}`, 400);
    }
    return json({ data: result });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message ?? "Action failed", 400);
  }
}
