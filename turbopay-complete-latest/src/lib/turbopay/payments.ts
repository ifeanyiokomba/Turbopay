import { db } from "@/lib/db";
import { reverseEntry, LedgerError } from "@/lib/turbopay/ledger";
import { audit } from "@/lib/turbopay/audit";
import { generateReference } from "@/lib/turbopay/reference";
import { checkDebit } from "@/lib/turbopay/aml";
import { transitionState } from "@/lib/turbopay/tx-state";
import { acquireUserDebitLock } from "@/lib/turbopay/advisory-lock";
import type { OutboxEventInput } from "@/lib/turbocore/outbox";
import { outbox } from "@/lib/turbocore/outbox";
import type { KycTier } from "@/lib/turbopay/types";
import type { Direction, RefType, TxStatus, TxType } from "@/lib/turbopay/types";

/**
 * PAYMENT ORCHESTRATOR — the safe "hold + confirm" pattern for all
 * provider-backed debits (airtime, data, electricity, utilities).
 *
 * Flow:
 *   1. Validate wallet status + balance (handled by caller).
 *   2. ATOMIC HOLD: debit the wallet (conditional UPDATE) and create the
 *      user-facing Transaction record + side-table row in PENDING status,
 *      all inside ONE Prisma transaction. This guarantees the ledger and the
 *      transaction history cannot drift apart.
 *      ── F6 ── When `input.aml` is provided, the AML `checkDebit` runs
 *      INSIDE this same tx (before the debit), making the AML velocity /
 *      daily-cap counters atomic with the debit. A burst of simultaneous
 *      requests can no longer each pass the AML check before any of them
 *      posts — the in-tx counts include all debits committed by prior txs.
 *   3. Call the provider.
 *      - SUCCESS → mark Transaction + side-table SUCCESS.
 *      - FAILURE → auto-REVERSE the hold (posts a REVERSAL ledger entry),
 *        mark Transaction + side-table FAILED. No funds stranded.
 *
 * This eliminates the prior liability bug where the provider was called BEFORE
 * the debit, leaving Turbopay liable if the balance was drained concurrently.
 *
 * ── F6 production note ─────────────────────────────────────────────
 * On PostgreSQL production, a per-user advisory lock (pg_advisory_xact_lock)
 * is acquired at the start of the holdDebit transaction. This serializes
 * concurrent debit transactions for the same user, preventing the read-skew
 * where two concurrent txs could each read pre-debit AML counters, both pass,
 * then both commit. On SQLite (dev), the advisory lock is a no-op — the
 * single-threaded JS event loop already prevents this race.
 *
 * See src/lib/turbopay/advisory-lock.ts for the implementation.
 */

/**
 * Typed error thrown by `executeProviderDebit` when the in-tx AML check
 * blocks the debit. Carries the AML reason so the route's catch block can
 * surface it as `400 AML_BLOCKED` (matching the pre-F6 route-level
 * errorJson shape — the client error handling is unchanged).
 */
export class AmlBlockedError extends Error {
  readonly code = "AML_BLOCKED";
  readonly frozeWallet?: boolean;
  readonly flags: { rule: string; severity: string; description: string }[];
  constructor(reason: string, opts?: { frozeWallet?: boolean; flags?: { rule: string; severity: string; description: string }[] }) {
    super(reason);
    this.name = "AmlBlockedError";
    this.frozeWallet = opts?.frozeWallet;
    this.flags = opts?.flags ?? [];
  }
}

export interface HoldInput {
  userId: string;
  walletId: string;
  type: TxType;
  refType: RefType;
  amountKobo: number;
  description: string;
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
  counterpartyBank?: string | null;
  provider: string;
  providerRef?: string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * Optional AML inputs. When provided, `checkDebit` runs INSIDE the hold's
   * Prisma transaction (before the debit) so the AML velocity / daily-cap
   * counters are read atomically with the debit (closes the F6 race window).
   * If the AML check blocks, the tx commits the AML side-effects (flags +
   * optional wallet freeze) WITHOUT debiting — `holdDebit` returns an
   * `{ amlBlocked: true, ... }` result + `executeProviderDebit` throws
   * `AmlBlockedError`.
   */
  aml?: { userId: string; kycTier: KycTier };
  /** Callback that creates the side-table row (AirtimeDataPurchase / BillPayment)
   *  inside the hold transaction, returning its id. */
  createSideRow?: (tx: Parameters<Parameters<typeof db["$transaction"]>[0]>[0], transactionId: string) => Promise<string>;
}

export interface HoldResult {
  transactionId: string;
  sideRowId?: string;
  ledgerEntryId: string;
  balanceAfterKobo: number;
}

/**
 * Discriminated result from `holdDebit`. When the in-tx AML check blocks,
 * `holdDebit` returns `{ amlBlocked: true, ... }` — the tx commits (so the
 * AML flags + optional wallet freeze persist) but NO debit / ledger entry /
 * Transaction row is created.
 */
export type HoldOutcome =
  | HoldResult
  | {
      amlBlocked: true;
      reason: string;
      frozeWallet?: boolean;
      flags: { rule: string; severity: string; description: string }[];
    };

/**
 * Step 1+2: atomically debit the wallet AND create the PENDING transaction
 * record (+ optional side-table row) in a single Prisma transaction.
 *
 * If `input.aml` is provided, the AML `checkDebit` runs at the start of the
 * tx (before the debit). On AML block the tx commits the AML side-effects
 * (flags + optional wallet freeze) WITHOUT debiting — the function returns
 * `{ amlBlocked: true, ... }` and the caller (`executeProviderDebit`) throws
 * `AmlBlockedError`.
 */
export async function holdDebit(input: HoldInput): Promise<HoldOutcome> {
  return db.$transaction(async (tx) => {
    // ── Advisory lock: serialize concurrent debits for the same user ──
    // Prevents the F6 read-skew where two concurrent txs each pass AML
    // counters before either posts its debit. The lock is held until the
    // tx commits/rolls back (pg_advisory_xact_lock is tx-scoped).
    await acquireUserDebitLock(tx, input.userId);

    // ── F6: in-tx AML check (atomic with the debit). ───────────────
    // Runs BEFORE the debit so the AML counters are read at the same logical
    // instant as the debit. The AML side-effects (flag writes + optional
    // wallet freeze) commit with the tx — so an AML freeze persists even
    // though no debit happened.
    if (input.aml) {
      const aml = await checkDebit(input.aml.userId, input.walletId, input.amountKobo, input.aml.kycTier, tx);
      if (!aml.allowed) {
        return {
          amlBlocked: true as const,
          reason: aml.reason ?? "Transaction blocked by risk monitoring",
          frozeWallet: aml.frozeWallet,
          flags: aml.flags,
        };
      }
    }

    // Conditional debit via raw updateMany-equivalent (handled in postDebitLeg).
    // We re-implement the conditional update here so the side-table row is
    // created in the same tx.
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
        currency: "NGN",
        refType: input.refType,
        balanceAfterKobo,
        description: input.description,
        immutable: true,
      },
    });

    const txRec = await tx.transaction.create({
      data: {
        reference: generateReference("TP"),
        userId: input.userId,
        walletId: input.walletId,
        type: input.type,
        direction: "DEBIT" as Direction,
        amountKobo: input.amountKobo,
        feeKobo: 0,
        status: "PENDING" as TxStatus,
        // Seed the state machine. Subsequent steps (HOLD_POSTED →
        // PROVIDER_CALLED → SETTLED/REVERSED) are advanced by
        // `executeProviderDebit` via `transitionState` (fire-and-forget).
        state: "INITIATED",
        counterpartyName: input.counterpartyName ?? null,
        counterpartyAccount: input.counterpartyAccount ?? null,
        counterpartyBank: input.counterpartyBank ?? null,
        description: input.description,
        provider: input.provider,
        providerRef: input.providerRef ?? null,
        metadata: input.metadata ? JSON.stringify({ ...input.metadata, ledgerEntryId: entry.id }) : JSON.stringify({ ledgerEntryId: entry.id }),
      },
    });

    let sideRowId: string | undefined;
    if (input.createSideRow) {
      sideRowId = await input.createSideRow(tx, txRec.id);
    }

    return { transactionId: txRec.id, sideRowId, ledgerEntryId: entry.id, balanceAfterKobo };
  }, { timeout: 15000 });
}

/**
 * Step 3-success: mark the held transaction + side-table row as SUCCESS.
 * Runs entirely inside one Prisma transaction — the Transaction update AND
 * the side-table update use the same `tx` so they cannot diverge. Also
 * back-fills the real providerRef onto the side-table's `reference` field
 * (previously stuck at "PENDING" forever).
 *
 * ── Transactional Outbox ──────────────────────────────────────────────
 * When `opts.outboxEvent` is provided, an `OutboxEvent` row is written
 * INSIDE this same transaction. This guarantees the event is persisted if
 * and only if the tx commits — eliminating the dual-write window where the
 * transaction status flips to SUCCESS but the downstream event-bus publish
 * is lost (e.g. process crash between commit + publish). The outbox cron
 * worker (`/api/cron/outbox-publisher`) picks up the row on the next tick
 * and publishes it via the TurboCore event bus.
 */
export async function confirmHold(
  transactionId: string,
  opts: { providerRef?: string | null; sideRowId?: string; sideModel?: "airtimeData" | "billPayment"; extraMetadata?: Record<string, unknown>; outboxEvent?: OutboxEventInput }
): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.transaction.findUnique({ where: { id: transactionId } });
    const meta = existing?.metadata ? JSON.parse(existing.metadata) : {};
    const providerRef = opts.providerRef ?? existing?.providerRef ?? null;
    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: "SUCCESS",
        providerRef,
        metadata: JSON.stringify({ ...meta, ...opts.extraMetadata, confirmedAt: new Date().toISOString() }),
      },
    });
    // FIX: use `tx` (not `db`) so the side-table update is in the SAME tx.
    // Also update the `reference` field from "PENDING" to the real providerRef.
    if (opts.sideRowId && opts.sideModel === "airtimeData") {
      await tx.airtimeDataPurchase.updateMany({ where: { id: opts.sideRowId }, data: { status: "SUCCESS", reference: providerRef ?? "SUCCESS" } });
    }
    if (opts.sideRowId && opts.sideModel === "billPayment") {
      await tx.billPayment.updateMany({ where: { id: opts.sideRowId }, data: { status: "SUCCESS", reference: providerRef ?? "SUCCESS" } });
    }
    // ── Transactional outbox: write the event row INSIDE this tx so the
    //    event is persisted iff the tx commits. The cron worker picks it
    //    up + publishes via the event bus on the next tick. This is the
    //    durable guarantee — the pipeline's direct `events.publish` call
    //    provides the immediate effect; the outbox provides the at-least-
    //    once delivery if the direct publish is lost.
    if (opts.outboxEvent) {
      await outbox.writeInTransaction(tx, opts.outboxEvent);
    }
  }, { timeout: 15000 });
}

/**
 * Step 3-failure: reverse the held debit, mark the transaction FAILED, and
 * record a REVERSAL ledger entry linked to the original. No funds stranded.
 *
 * FIX: the ledger reversal AND the status update now run inside ONE Prisma
 * transaction (previously they were two separate transactions, leaving an
 * inconsistency window if the process crashed between them). `reverseEntry`
 * accepts the caller's `tx` to make this possible.
 */
export async function reverseHold(
  transactionId: string,
  ledgerEntryId: string,
  reason: string,
  opts: { sideRowId?: string; sideModel?: "airtimeData" | "billPayment" }
): Promise<void> {
  await db.$transaction(async (tx) => {
    // Reverse the ledger entry INSIDE this transaction (no separate tx).
    const reversal = await reverseEntry(ledgerEntryId, { description: `Reversal: ${reason}` }, tx);

    const existing = await tx.transaction.findUnique({ where: { id: transactionId } });
    const meta = existing?.metadata ? JSON.parse(existing.metadata) : {};
    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: "FAILED",
        metadata: JSON.stringify({ ...meta, reversalEntryId: reversal.reversalEntryId, reversalReason: reason, reversedAt: new Date().toISOString() }),
      },
    });
    // FIX: use `tx` (not `db`) so the side-table update is in the SAME tx.
    if (opts.sideRowId && opts.sideModel === "airtimeData") {
      await tx.airtimeDataPurchase.updateMany({ where: { id: opts.sideRowId }, data: { status: "FAILED", reference: "REVERSED" } });
    }
    if (opts.sideRowId && opts.sideModel === "billPayment") {
      await tx.billPayment.updateMany({ where: { id: opts.sideRowId }, data: { status: "FAILED", reference: "REVERSED" } });
    }

    await audit({ action: "HOLD_REVERSED", category: "WALLET", severity: "WARN", metadata: { transactionId, reason } });
  }, { timeout: 15000 });
}

/**
 * High-level helper: run a provider-backed debit with full hold/confirm/reverse
 * semantics. `providerCall` is invoked AFTER the hold succeeds; if it throws,
 * the hold is reversed automatically.
 *
 * If `input.aml` is provided, the AML check runs inside the hold's tx. On
 * AML block, no hold is created (no debit, no Transaction row, no ledger
 * entry) — the AML side-effects (flags + optional wallet freeze) DO persist
 * — and `AmlBlockedError` is thrown so the route's catch block can surface
 * `400 AML_BLOCKED` to the client.
 *
 * If `input.outboxEvent` is provided, it is written INSIDE the confirm
 * transaction (atomically with the SUCCESS status flip). The caller supplies
 * the event payload MINUS the `aggregateId` (transaction ID), which is
 * filled in from the held transaction's ID before the outbox row is written.
 * This is the transactional-outbox guarantee: the event is persisted iff the
 * payment succeeds.
 */
export async function executeProviderDebit(input: HoldInput & {
  providerCall: () => Promise<{ providerRef: string; extra?: Record<string, unknown> }>;
  sideModel?: "airtimeData" | "billPayment";
  /**
   * Optional outbox event to write INSIDE the confirm transaction. The
   * `aggregateId` field is auto-filled with the held transaction's ID; the
   * caller supplies `aggregateType`, `eventType`, and `payload`.
   */
  outboxEvent?: Omit<OutboxEventInput, "aggregateId">;
}): Promise<{ transactionId: string; reference: string; providerRef: string; newBalanceKobo: number }> {
  const hold = await holdDebit({
    userId: input.userId,
    walletId: input.walletId,
    type: input.type,
    refType: input.refType,
    amountKobo: input.amountKobo,
    description: input.description,
    counterpartyName: input.counterpartyName,
    counterpartyAccount: input.counterpartyAccount,
    counterpartyBank: input.counterpartyBank,
    provider: input.provider,
    providerRef: input.providerRef,
    metadata: input.metadata,
    aml: input.aml,
    createSideRow: input.createSideRow,
  });

  // ── F6: AML blocked the debit inside the hold tx. ──────────────
  // No debit happened (no hold to reverse), but the AML side-effects
  // (flags + optional wallet freeze) have already committed. Surface the
  // block as a typed error so the route can return 400 AML_BLOCKED.
  if ("amlBlocked" in hold) {
    throw new AmlBlockedError(hold.reason, { frozeWallet: hold.frozeWallet, flags: hold.flags });
  }

  // ── State machine: hold is posted (debit + ledger entry written). ────
  // Fire-and-forget: a state-tracking failure must NEVER block the financial
  // transaction. The `transitionState` helper already swallows its own errors,
  // and the `.catch(() => null)` here is the belt-and-braces guarantee.
  await transitionState(hold.transactionId, "HOLD_POSTED").catch(() => null);

  // ── State machine: about to call the external provider. ──────────────
  // This is the critical seam the stuck-tx sweeper looks for — if the process
  // crashes here, the transaction is in PROVIDER_CALLED with status=PENDING
  // and the sweeper will reverse it after the 2-minute SLA.
  await transitionState(hold.transactionId, "PROVIDER_CALLED").catch(() => null);

  try {
    const result = await input.providerCall();
    // Build the full outbox event with the transaction ID filled in.
    const outboxEvent: OutboxEventInput | undefined = input.outboxEvent
      ? { ...input.outboxEvent, aggregateId: hold.transactionId }
      : undefined;
    await confirmHold(hold.transactionId, {
      providerRef: result.providerRef,
      sideRowId: hold.sideRowId,
      sideModel: input.sideModel,
      extraMetadata: result.extra,
      outboxEvent,
    });
    // ── State machine: provider call succeeded, hold confirmed. ──────
    await transitionState(hold.transactionId, "SETTLED").catch(() => null);
    const ref = await db.transaction.findUnique({ where: { id: hold.transactionId }, select: { reference: true } });
    return { transactionId: hold.transactionId, reference: ref!.reference, providerRef: result.providerRef, newBalanceKobo: hold.balanceAfterKobo };
  } catch (e: any) {
    await reverseHold(hold.transactionId, hold.ledgerEntryId, e?.message ?? "PROVIDER_ERROR", {
      sideRowId: hold.sideRowId,
      sideModel: input.sideModel,
    });
    // ── State machine: provider call failed, hold auto-reversed. ─────
    await transitionState(hold.transactionId, "REVERSED").catch(() => null);
    throw e;
  }
}

// generateReference is imported from @/lib/turbopay/reference at the top of
// this file (resolves the prior circular-dependency workaround).
