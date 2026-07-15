/**
 * TurboCore — Platform Revenue & Fee Ledger
 * ===========================================
 *
 * Tracks TurboPay's own revenue (fees, commissions, VAT) as separate
 * double-entry ledger legs on the existing ledger engine. No parallel
 * accounting system — just more platform-owned wallets that the existing
 * ledger.ts already knows how to move money between.
 *
 * Pattern: mirrors PLATFORM_INVESTMENT_POOL_WALLET_ID from investments/.
 * Revenue wallets are system-owned, balanceAfterKobo is always 0 (they're
 * pass-through accounts), and every fee-bearing transaction produces a
 * CREDIT leg into the appropriate revenue wallet.
 */

import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import type { RefType } from "@/lib/turbopay/types";

// ─── Platform Revenue Wallets ───────────────────────────────

export const PLATFORM_REVENUE_WALLET_ID = "PLATFORM_REVENUE";
export const PLATFORM_FEE_WALLET_ID = "PLATFORM_FEES";
const PLATFORM_REVENUE_USER_ID = "PLATFORM_REVENUE_USER";
const PLATFORM_REVENUE_EMAIL = "platform-revenue@turbopay.internal";

/**
 * Ensure platform revenue wallets exist. Idempotent — safe to call on every
 * boot or transaction. Each wallet is a real Wallet row so the FK on
 * LedgerEntry.walletId is satisfied.
 */
export async function ensurePlatformRevenueWallets(): Promise<void> {
  // Create the system user if it doesn't exist.
  await db.user.upsert({
    where: { id: PLATFORM_REVENUE_USER_ID },
    create: {
      id: PLATFORM_REVENUE_USER_ID,
      fullName: "Turbopay Revenue",
      email: PLATFORM_REVENUE_EMAIL,
      kycTier: 3,
      kycStatus: "VERIFIED",
      status: "ACTIVE",
      role: "USER",
      emailVerified: true,
    },
    update: {},
  });

  // Revenue wallet (captures all TurboPay fee income).
  await db.wallet.upsert({
    where: { id: PLATFORM_REVENUE_WALLET_ID },
    create: {
      id: PLATFORM_REVENUE_WALLET_ID,
      userId: PLATFORM_REVENUE_USER_ID,
      balanceKobo: 0,
      currency: "NGN",
      status: "ACTIVE",
    },
    update: {},
  });

  // Fee wallet (captures specific fee breakdowns — can be split further).
  await db.wallet.upsert({
    where: { id: PLATFORM_FEE_WALLET_ID },
    create: {
      id: PLATFORM_FEE_WALLET_ID,
      userId: PLATFORM_REVENUE_USER_ID,
      balanceKobo: 0,
      currency: "NGN",
      status: "ACTIVE",
    },
    update: {},
  });
}

// ─── Revenue Posting ────────────────────────────────────────

/**
 * Post a fee credit into the platform revenue wallet. Called after every
 * transaction that carries a TurboPay fee. The fee is already included in
 * the customer's total debit — this leg captures TurboPay's cut into the
 * revenue account so the ledger stays balanced.
 *
 * balanceAfterKobo is always 0 — platform revenue accounts are pass-through
 * (same pattern as the investment pool).
 */
export async function postFeeRevenue(opts: {
  amountKobo: number;
  refType: RefType;
  refId: string;
  description: string;
  currency?: string;
}): Promise<{ ledgerEntryId: string }> {
  await ensurePlatformRevenueWallets();

  // Read the wallet to get a valid walletId for the FK.
  const wallet = await db.wallet.findUnique({
    where: { id: PLATFORM_REVENUE_WALLET_ID },
    select: { id: true },
  });
  if (!wallet) throw new Error("Platform revenue wallet not initialized");

  const entry = await db.ledgerEntry.create({
    data: {
      walletId: wallet.id,
      entryType: "CREDIT",
      amountKobo: opts.amountKobo,
      currency: opts.currency ?? "NGN",
      refType: opts.refType,
      refId: opts.refId,
      balanceAfterKobo: 0, // pass-through account
      description: opts.description,
      immutable: true,
    },
  });

  return { ledgerEntryId: entry.id };
}

/**
 * Post a fee split into multiple revenue accounts. Used when a transaction
 * carries multiple fee components (TurboPay fee, VAT, partner commission).
 *
 * Each split is a separate ledger leg — all credited to the platform revenue
 * wallet with different descriptions for reconciliation.
 */
export async function postFeeSplit(opts: {
  splits: Array<{
    amountKobo: number;
    label: string; // e.g. "TurboPay fee", "VAT", "Partner commission"
  }>;
  refType: RefType;
  refId: string;
  currency?: string;
}): Promise<{ ledgerEntryIds: string[] }> {
  const entryIds: string[] = [];

  for (const split of opts.splits) {
    if (split.amountKobo <= 0) continue;
    const result = await postFeeRevenue({
      amountKobo: split.amountKobo,
      refType: opts.refType,
      refId: opts.refId,
      description: `${opts.refId} — ${split.label}`,
      currency: opts.currency,
    });
    entryIds.push(result.ledgerEntryId);
  }

  return { ledgerEntryIds: entryIds };
}

// ─── Revenue Query ──────────────────────────────────────────

/**
 * Get the total revenue for a given period. Queries the platform revenue
 * wallet's ledger entries.
 */
export async function getRevenueSummary(opts: {
  from: Date;
  to: Date;
  currency?: string;
}): Promise<{ totalFeesKobo: number; transactionCount: number }> {
  const wallet = await db.wallet.findUnique({
    where: { id: PLATFORM_REVENUE_WALLET_ID },
    select: { id: true },
  });
  if (!wallet) return { totalFeesKobo: 0, transactionCount: 0 };

  const [sum, count] = await Promise.all([
    db.ledgerEntry.aggregate({
      where: {
        walletId: wallet.id,
        entryType: "CREDIT",
        currency: opts.currency ?? "NGN",
        createdAt: { gte: opts.from, lte: opts.to },
      },
      _sum: { amountKobo: true },
    }),
    db.ledgerEntry.count({
      where: {
        walletId: wallet.id,
        entryType: "CREDIT",
        currency: opts.currency ?? "NGN",
        createdAt: { gte: opts.from, lte: opts.to },
      },
    }),
  ]);

  return {
    totalFeesKobo: sum._sum.amountKobo ?? 0,
    transactionCount: count,
  };
}
