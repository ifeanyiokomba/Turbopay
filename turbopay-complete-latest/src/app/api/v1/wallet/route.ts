import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { getWalletView } from "@/lib/turbopay/wallet";

/**
 * GET /api/v1/wallet — Get wallet balance and details.
 *
 * Versioned endpoint with stable response contract.
 * Returns wallet balance (cached), ledger balance (authoritative), and status.
 */
export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const wallet = await getWalletView(user.id);
  if (!wallet) return errorJson("Wallet not found", 404, "WALLET_NOT_FOUND");

  return json({
    data: {
      id: wallet.id,
      balanceKobo: wallet.balanceKobo,
      ledgerBalanceKobo: wallet.ledgerBalanceKobo,
      currency: wallet.currency,
      status: wallet.status,
      balanceFormatted: `₦${(wallet.balanceKobo / 100).toLocaleString()}`,
    },
    meta: {
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    },
  });
}
