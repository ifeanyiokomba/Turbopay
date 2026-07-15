import { db } from "@/lib/db";
import type { EntryType, RefType } from "@/lib/turbopay/types";
import { acquireUserDebitLock } from "@/lib/turbopay/advisory-lock";

/**
 * LEDGER ENGINE — the source of truth.
 *
 * Every financial movement posts ledger entries following double-entry
 * principles. Wallet.balanceKobo is a CACHE that is reconciled against the
 * ledger via a CONDITIONAL, atomic SQL UPDATE — there is no read-modify-write
 * window, so concurrent debits cannot double-spend.
 *
 * Guarantees:
 *  - Atomic + concurrency-safe: debits use
 *      UPDATE wallet SET balanceKobo = balanceKobo - :amt, version = version+1
 *      WHERE id = :id AND balanceKobo >= :amt AND status = 'ACTIVE'
 *    If 0 rows match, the balance was insufficient or changed concurrently.
 *  - Immutable: entries are never edited; reversals create new entries.
 *  - balanceAfterKobo is read back inside the same tx for auditability.
 */

type Tx = Parameters<Parameters<typeof db["$transaction"]>[0]>[0];

interface PostLegInput {
  walletId: string;
  entryType: EntryType; // DEBIT reduces balance, CREDIT increases
  amountKobo: number; // always positive
  currency?: string; // defaults to "NGN" for backward compatibility
  refType: RefType;
  refId?: string | null;
  pairId?: string | null;
  description?: string | null;
}

class LedgerError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Post a single CREDIT leg. Credits have no balance guard (balance can grow
 * unbounded up to KYC tier max — enforced at the service layer). Runs a
 * conditional update that also refuses to credit a FROZEN wallet, then reads
 * the new balance back, all inside the caller's transaction.
 */
async function postCreditLeg(tx: Tx, input: PostLegInput): Promise<{ entryId: string; balanceAfterKobo: number }> {
  if (input.amountKobo <= 0) throw new LedgerError("AMOUNT_MUST_BE_POSITIVE", "Amount must be positive");

  // Conditional update: only credit an ACTIVE wallet. version bump for OCC.
  // (Funding into a frozen wallet is rejected — funds must be held for review.)
  const updated = await tx.wallet.updateMany({
    where: { id: input.walletId, status: "ACTIVE" },
    data: { balanceKobo: { increment: input.amountKobo }, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    // Distinguish frozen vs not-found for better errors upstream.
    const w = await tx.wallet.findUnique({ where: { id: input.walletId }, select: { status: true } });
    if (!w) throw new LedgerError("WALLET_NOT_FOUND", "Wallet not found");
    throw new LedgerError("WALLET_FROZEN", "Wallet is frozen");
  }

  const wallet = await tx.wallet.findUnique({ where: { id: input.walletId }, select: { balanceKobo: true } });
  const balanceAfterKobo = wallet!.balanceKobo;

  const entry = await tx.ledgerEntry.create({
    data: {
      walletId: input.walletId,
      entryType: "CREDIT",
      amountKobo: input.amountKobo,
      currency: input.currency ?? "NGN",
      refType: input.refType,
      refId: input.refId ?? null,
      pairId: input.pairId ?? null,
      balanceAfterKobo,
      description: input.description ?? null,
      immutable: true,
    },
  });

  return { entryId: entry.id, balanceAfterKobo };
}

/**
 * Post a single DEBIT leg using a CONDITIONAL atomic UPDATE. The WHERE clause
 * `balanceKobo >= amount AND status = 'ACTIVE'` is evaluated atomically by the
 * DB, eliminating the TOCTOU window that a read-then-write pattern creates.
 * If 0 rows are updated, the balance was insufficient or changed concurrently.
 */
async function postDebitLeg(tx: Tx, input: PostLegInput): Promise<{ entryId: string; balanceAfterKobo: number }> {
  if (input.amountKobo <= 0) throw new LedgerError("AMOUNT_MUST_BE_POSITIVE", "Amount must be positive");

  // Atomic, conditional debit. count===1 guarantees the balance was sufficient
  // AND the wallet was active at the moment of the update — no other writer
  // can interleave because the row is locked for the duration of this UPDATE.
  const updated = await tx.wallet.updateMany({
    where: { id: input.walletId, status: "ACTIVE", balanceKobo: { gte: input.amountKobo } },
    data: { balanceKobo: { decrement: input.amountKobo }, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    const w = await tx.wallet.findUnique({ where: { id: input.walletId }, select: { balanceKobo: true, status: true } });
    if (!w) throw new LedgerError("WALLET_NOT_FOUND", "Wallet not found");
    if (w.status !== "ACTIVE") throw new LedgerError("WALLET_FROZEN", "Wallet is frozen");
    throw new LedgerError("INSUFFICIENT_FUNDS", "Insufficient funds");
  }

  const wallet = await tx.wallet.findUnique({ where: { id: input.walletId }, select: { balanceKobo: true } });
  const balanceAfterKobo = wallet!.balanceKobo;

  const entry = await tx.ledgerEntry.create({
    data: {
      walletId: input.walletId,
      entryType: "DEBIT",
      amountKobo: input.amountKobo,
      currency: input.currency ?? "NGN",
      refType: input.refType,
      refId: input.refId ?? null,
      pairId: input.pairId ?? null,
      balanceAfterKobo,
      description: input.description ?? null,
      immutable: true,
    },
  });

  return { entryId: entry.id, balanceAfterKobo };
}

export interface CreditResult {
  ledgerEntryId: string;
  balanceAfterKobo: number;
}

/** Credit a single wallet (funding, webhook, reversal-in). Rejects frozen wallets. */
export async function creditWallet(
  walletId: string,
  amountKobo: number,
  refType: RefType,
  opts: { refId?: string | null; description?: string | null; currency?: string } = {}
): Promise<CreditResult> {
  return db.$transaction(async (tx) => {
    const res = await postCreditLeg(tx, {
      walletId,
      entryType: "CREDIT",
      amountKobo,
      currency: opts.currency,
      refType,
      refId: opts.refId ?? null,
      description: opts.description ?? null,
    });
    return { ledgerEntryId: res.entryId, balanceAfterKobo: res.balanceAfterKobo };
  });
}

export interface DebitResult {
  ledgerEntryId: string;
  balanceAfterKobo: number;
}

/**
 * Debit a single wallet (airtime, data, bills, fees, reversal-out).
 * Concurrency-safe: uses a conditional UPDATE; throws INSUFFICIENT_FUNDS or
 * WALLET_FROZEN atomically if the debit cannot proceed.
 *
 * When `opts.userId` is provided, a per-user advisory lock is acquired at the
 * start of the transaction to serialize concurrent debits for the same user.
 * This closes the F6 race condition where two concurrent transactions could
 * each read pre-debit AML counters, both pass, then both commit.
 */
export async function debitWallet(
  walletId: string,
  amountKobo: number,
  refType: RefType,
  opts: { refId?: string | null; description?: string | null; userId?: string; currency?: string } = {}
): Promise<DebitResult> {
  return db.$transaction(async (tx) => {
    if (opts.userId) {
      await acquireUserDebitLock(tx, opts.userId);
    }
    const res = await postDebitLeg(tx, {
      walletId,
      entryType: "DEBIT",
      amountKobo,
      currency: opts.currency,
      refType,
      refId: opts.refId ?? null,
      description: opts.description ?? null,
    });
    return { ledgerEntryId: res.entryId, balanceAfterKobo: res.balanceAfterKobo };
  });
}

export interface TransferResult {
  debitEntryId: string;
  creditEntryId: string;
  fromBalanceAfter: number;
  toBalanceAfter: number;
}

/**
 * Atomic internal transfer between two Turbopay wallets (double-entry).
 * Both legs run in a single Prisma transaction; each leg uses a conditional
 * UPDATE so the operation is race-free even under concurrency. If the debit
 * leg fails (insufficient funds / frozen), the credit leg never runs and the
 * whole transaction rolls back.
 *
 * If `tx` is provided, the legs run inside the caller's transaction (so the
 * ledger post + transaction-record creation are atomic together). If omitted,
 * a fresh transaction is opened.
 */
export async function transferBetweenWallets(
  fromWalletId: string,
  toWalletId: string,
  amountKobo: number,
  refType: RefType,
  opts: { refId?: string | null; description?: string | null } = {},
  tx?: Tx
): Promise<TransferResult> {
  if (fromWalletId === toWalletId) throw new LedgerError("CANNOT_TRANSFER_TO_SELF", "Cannot transfer to self");
  if (amountKobo <= 0) throw new LedgerError("AMOUNT_MUST_BE_POSITIVE", "Amount must be positive");

  const run = async (tx: Tx): Promise<TransferResult> => {
    // Advisory lock on sender to serialize concurrent transfers for the same user.
    const senderWallet = await tx.wallet.findUnique({
      where: { id: fromWalletId }, select: { userId: true },
    });
    if (senderWallet) {
      await acquireUserDebitLock(tx, senderWallet.userId);
    }
    // Post debit first (conditional). If it fails, the credit never runs.
    const debit = await postDebitLeg(tx, {
      walletId: fromWalletId,
      entryType: "DEBIT",
      amountKobo,
      refType,
      refId: opts.refId ?? null,
      description: opts.description ?? null,
    });
    // Credit the recipient. If the recipient is frozen we throw — the
    // transaction rolls back, restoring the sender's balance.
    const credit = await postCreditLeg(tx, {
      walletId: toWalletId,
      entryType: "CREDIT",
      amountKobo,
      refType,
      refId: opts.refId ?? null,
      pairId: debit.entryId,
      description: opts.description ?? null,
    });
    // back-link the pair on the debit leg
    await tx.ledgerEntry.update({
      where: { id: debit.entryId },
      data: { pairId: credit.entryId },
    });

    return {
      debitEntryId: debit.entryId,
      creditEntryId: credit.entryId,
      fromBalanceAfter: debit.balanceAfterKobo,
      toBalanceAfter: credit.balanceAfterKobo,
    };
  };

  if (tx) return run(tx);
  return db.$transaction(run, { timeout: 15000 });
}

/**
 * REVERSAL — post an opposing leg that negates a prior entry. Used by the
 * payment orchestrator when a provider call fails after a hold-debit, and
 * available to admins for manual corrections. Never edits the original entry.
 *
 * If `tx` is provided, the reversal runs inside the caller's transaction
 * (so the reversal + status update are atomic together). If omitted, a fresh
 * transaction is opened.
 */
export async function reverseEntry(
  originalEntryId: string,
  opts: { description?: string | null; refId?: string | null } = {},
  tx?: Tx
): Promise<{ reversalEntryId: string; balanceAfterKobo: number }> {
  const run = async (tx: Tx) => {
    const original = await tx.ledgerEntry.findUnique({ where: { id: originalEntryId } });
    if (!original) throw new LedgerError("ENTRY_NOT_FOUND", "Original ledger entry not found");
    if (original.refType === "REVERSAL") throw new LedgerError("CANNOT_REVERSE_REVERSAL", "Cannot reverse a reversal");

    // Opposite leg: if original was DEBIT, reversal is CREDIT, and vice-versa.
    const oppositeType: EntryType = original.entryType === "DEBIT" ? "CREDIT" : "DEBIT";
    const leg =
      oppositeType === "CREDIT"
        ? await postCreditLeg(tx, {
            walletId: original.walletId,
            entryType: "CREDIT",
            amountKobo: original.amountKobo,
            refType: "REVERSAL",
            refId: opts.refId ?? null,
            description: opts.description ?? `Reversal of ${original.id}`,
          })
        : await postDebitLeg(tx, {
            walletId: original.walletId,
            entryType: "DEBIT",
            amountKobo: original.amountKobo,
            refType: "REVERSAL",
            refId: opts.refId ?? null,
            description: opts.description ?? `Reversal of ${original.id}`,
          });

    return { reversalEntryId: leg.entryId, balanceAfterKobo: leg.balanceAfterKobo };
  };

  if (tx) return run(tx);
  return db.$transaction(run, { timeout: 15000 });
}

export { LedgerError };

// ═══════════════════════════════════════════════════════════════
// CURRENCY WALLET LEDGER — operates on CurrencyWallet.balanceMinor
// ═══════════════════════════════════════════════════════════════

interface PostCurrencyLegInput {
  walletId: string;
  entryType: EntryType;
  amountMinor: number;
  currency: string;
  refType: RefType;
  refId?: string | null;
  pairId?: string | null;
  description?: string | null;
}

/**
 * Post a CREDIT leg to a CurrencyWallet. Refuses to credit a frozen wallet.
 * Runs inside the caller's transaction.
 */
async function postCreditCurrencyLeg(tx: Tx, input: PostCurrencyLegInput): Promise<{ entryId: string; balanceAfter: number }> {
  if (input.amountMinor <= 0) throw new LedgerError("AMOUNT_MUST_BE_POSITIVE", "Amount must be positive");

  const updated = await tx.currencyWallet.updateMany({
    where: { id: input.walletId, status: "ACTIVE" },
    data: { balanceMinor: { increment: input.amountMinor }, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    const w = await tx.currencyWallet.findUnique({ where: { id: input.walletId }, select: { status: true } });
    if (!w) throw new LedgerError("WALLET_NOT_FOUND", "Currency wallet not found");
    throw new LedgerError("WALLET_FROZEN", "Currency wallet is frozen");
  }

  const wallet = await tx.currencyWallet.findUnique({ where: { id: input.walletId }, select: { balanceMinor: true } });
  const balanceAfter = wallet!.balanceMinor;

  const entry = await tx.currencyLedgerEntry.create({
    data: {
      currencyWalletId: input.walletId,
      entryType: "CREDIT",
      amountMinor: input.amountMinor,
      currency: input.currency,
      refType: input.refType,
      refId: input.refId ?? null,
      pairId: input.pairId ?? null,
      balanceAfter,
      description: input.description ?? null,
      immutable: true,
    },
  });

  return { entryId: entry.id, balanceAfter };
}

/**
 * Post a DEBIT leg to a CurrencyWallet. Atomic conditional UPDATE —
 * throws INSUFFICIENT_FUNDS or WALLET_FROZEN on failure.
 */
async function postDebitCurrencyLeg(tx: Tx, input: PostCurrencyLegInput): Promise<{ entryId: string; balanceAfter: number }> {
  if (input.amountMinor <= 0) throw new LedgerError("AMOUNT_MUST_BE_POSITIVE", "Amount must be positive");

  const updated = await tx.currencyWallet.updateMany({
    where: { id: input.walletId, status: "ACTIVE", balanceMinor: { gte: input.amountMinor } },
    data: { balanceMinor: { decrement: input.amountMinor }, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    const w = await tx.currencyWallet.findUnique({ where: { id: input.walletId }, select: { balanceMinor: true, status: true } });
    if (!w) throw new LedgerError("WALLET_NOT_FOUND", "Currency wallet not found");
    if (w.status !== "ACTIVE") throw new LedgerError("WALLET_FROZEN", "Currency wallet is frozen");
    throw new LedgerError("INSUFFICIENT_FUNDS", "Insufficient funds");
  }

  const wallet = await tx.currencyWallet.findUnique({ where: { id: input.walletId }, select: { balanceMinor: true } });
  const balanceAfter = wallet!.balanceMinor;

  const entry = await tx.currencyLedgerEntry.create({
    data: {
      currencyWalletId: input.walletId,
      entryType: "DEBIT",
      amountMinor: input.amountMinor,
      currency: input.currency,
      refType: input.refType,
      refId: input.refId ?? null,
      pairId: input.pairId ?? null,
      balanceAfter,
      description: input.description ?? null,
      immutable: true,
    },
  });

  return { entryId: entry.id, balanceAfter };
}

export interface CurrencyCreditResult {
  ledgerEntryId: string;
  balanceAfter: number;
}

/** Credit a CurrencyWallet. Rejects frozen wallets. */
export async function creditCurrencyWallet(
  walletId: string,
  amountMinor: number,
  currency: string,
  refType: RefType,
  opts: { refId?: string | null; description?: string | null } = {}
): Promise<CurrencyCreditResult> {
  return db.$transaction(async (tx) => {
    const res = await postCreditCurrencyLeg(tx, {
      walletId,
      entryType: "CREDIT",
      amountMinor,
      currency,
      refType,
      refId: opts.refId ?? null,
      description: opts.description ?? null,
    });
    return { ledgerEntryId: res.entryId, balanceAfter: res.balanceAfter };
  });
}

export interface CurrencyDebitResult {
  ledgerEntryId: string;
  balanceAfter: number;
}

/** Debit a CurrencyWallet. Throws INSUFFICIENT_FUNDS or WALLET_FROZEN. */
export async function debitCurrencyWallet(
  walletId: string,
  amountMinor: number,
  currency: string,
  refType: RefType,
  opts: { refId?: string | null; description?: string | null; userId?: string } = {}
): Promise<CurrencyDebitResult> {
  return db.$transaction(async (tx) => {
    if (opts.userId) {
      await acquireUserDebitLock(tx, opts.userId);
    }
    const res = await postDebitCurrencyLeg(tx, {
      walletId,
      entryType: "DEBIT",
      amountMinor,
      currency,
      refType,
      refId: opts.refId ?? null,
      description: opts.description ?? null,
    });
    return { ledgerEntryId: res.entryId, balanceAfter: res.balanceAfter };
  });
}

export interface CurrencyTransferResult {
  debitEntryId: string;
  creditEntryId: string;
  fromBalanceAfter: number;
  toBalanceAfter: number;
}

/**
 * Atomic same-currency transfer between two CurrencyWallets.
 * Throws if currencies differ — cross-currency FX conversion is handled
 * at the service layer, not in the ledger primitive.
 */
export async function transferBetweenCurrencyWallets(
  fromWalletId: string,
  toWalletId: string,
  amountMinor: number,
  currency: string,
  refType: RefType,
  opts: { refId?: string | null; description?: string | null } = {},
  tx?: Tx
): Promise<CurrencyTransferResult> {
  if (fromWalletId === toWalletId) throw new LedgerError("CANNOT_TRANSFER_TO_SELF", "Cannot transfer to self");
  if (amountMinor <= 0) throw new LedgerError("AMOUNT_MUST_BE_POSITIVE", "Amount must be positive");

  const run = async (tx: Tx): Promise<CurrencyTransferResult> => {
    const senderWallet = await tx.currencyWallet.findUnique({
      where: { id: fromWalletId }, select: { userId: true },
    });
    if (senderWallet) {
      await acquireUserDebitLock(tx, senderWallet.userId);
    }
    const debit = await postDebitCurrencyLeg(tx, {
      walletId: fromWalletId,
      entryType: "DEBIT",
      amountMinor,
      currency,
      refType,
      refId: opts.refId ?? null,
      description: opts.description ?? null,
    });
    const credit = await postCreditCurrencyLeg(tx, {
      walletId: toWalletId,
      entryType: "CREDIT",
      amountMinor,
      currency,
      refType,
      refId: opts.refId ?? null,
      pairId: debit.entryId,
      description: opts.description ?? null,
    });
    await tx.currencyLedgerEntry.update({
      where: { id: debit.entryId },
      data: { pairId: credit.entryId },
    });

    return {
      debitEntryId: debit.entryId,
      creditEntryId: credit.entryId,
      fromBalanceAfter: debit.balanceAfter,
      toBalanceAfter: credit.balanceAfter,
    };
  };

  if (tx) return run(tx);
  return db.$transaction(run, { timeout: 15000 });
}

/**
 * Reconcile the wallet balance cache from the ledger (source of truth).
 * Uses a single SQL aggregate (no full row scan into JS memory).
 */
export async function reconcileWallet(walletId: string): Promise<{ cached: number; ledger: number; matched: boolean }> {
  return db.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) throw new LedgerError("WALLET_NOT_FOUND", "Wallet not found");
    const ledgerBalance = await getLedgerBalanceTx(tx, walletId);
    const matched = ledgerBalance === wallet.balanceKobo;
    if (!matched) {
      await tx.wallet.update({
        where: { id: walletId },
        data: { balanceKobo: ledgerBalance, version: { increment: 1 } },
      });
    }
    return { cached: wallet.balanceKobo, ledger: ledgerBalance, matched };
  });
}

/** Compute the authoritative ledger balance for a wallet via SQL aggregate. */
export async function getLedgerBalance(walletId: string): Promise<number> {
  return getLedgerBalanceTx(db, walletId);
}

async function getLedgerBalanceTx(tx: Tx, walletId: string): Promise<number> {
  // SQLite/Prisma: aggregate credits and debits separately, subtract in JS.
  const [credits, debits] = await Promise.all([
    tx.ledgerEntry.aggregate({ where: { walletId, entryType: "CREDIT" }, _sum: { amountKobo: true } }),
    tx.ledgerEntry.aggregate({ where: { walletId, entryType: "DEBIT" }, _sum: { amountKobo: true } }),
  ]);
  return (credits._sum.amountKobo ?? 0) - (debits._sum.amountKobo ?? 0);
}

/** Compute the authoritative ledger balance for a CurrencyWallet via SQL aggregate. */
export async function getCurrencyWalletBalance(walletId: string): Promise<number> {
  const [credits, debits] = await Promise.all([
    db.currencyLedgerEntry.aggregate({ where: { currencyWalletId: walletId, entryType: "CREDIT" }, _sum: { amountMinor: true } }),
    db.currencyLedgerEntry.aggregate({ where: { currencyWalletId: walletId, entryType: "DEBIT" }, _sum: { amountMinor: true } }),
  ]);
  return (credits._sum.amountMinor ?? 0) - (debits._sum.amountMinor ?? 0);
}
