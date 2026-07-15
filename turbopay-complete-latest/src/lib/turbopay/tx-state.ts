/**
 * TRANSACTION STATE MACHINE
 * =========================
 *
 * Coarse-grained lifecycle states for every provider-backed debit. The
 * `Transaction.state` column (nullable on legacy rows) records the LAST state
 * the transaction reached before its terminal outcome — the sweeper uses it to
 * detect transactions that crashed mid-flight (state stuck at HOLD_POSTED or
 * PROVIDER_CALLED with status=PENDING) and reverses them safely.
 *
 *   INITIATED          Transaction row created (holdDebit just inserted the row)
 *        ↓
 *   PIN_VERIFIED       Transaction PIN check passed (caller-managed step)
 *        ↓
 *   AML_CHECKED        AML velocity / amount check passed (in-tx for F6)
 *        ↓
 *   HOLD_POSTED        Wallet debited + ledger entry written (holdDebit returned)
 *        ↓
 *   PROVIDER_CALLED    About to invoke the external provider
 *        ↓
 *   SETTLED | REVERSED | TIMEOUT       (terminal)
 *
 * ── Design rules ──────────────────────────────────────────────────────
 *   • Forward-only: every transition must be a step DOWN the chain above.
 *     `isValidTransition` encodes the directed adjacency map.
 *   • Terminal states (SETTLED, REVERSED, TIMEOUT) accept NO further
 *     transitions — the sweeper relies on this to skip already-resolved rows.
 *   • `transitionState` is fire-and-forget from the caller's perspective: it
 *     MUST NOT throw. Every call site in payments.ts wraps it in
 *     `.catch(() => null)` so a state-machine failure can never block the
 *     financial transaction.
 *   • Optimistic concurrency: the UPDATE is a conditional `updateMany` with
 *     `WHERE id = ? AND state = ?` — two concurrent transitions cannot both
 *     win. The audit log records the actual before/after pair.
 */

import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";

export const TX_STATES = [
  "INITIATED",
  "PIN_VERIFIED",
  "AML_CHECKED",
  "HOLD_POSTED",
  "PROVIDER_CALLED",
  "SETTLED",
  "REVERSED",
  "TIMEOUT",
] as const;
export type TxState = (typeof TX_STATES)[number];

/** States from which no further transition is possible. */
export const TERMINAL_STATES = new Set<TxState>(["SETTLED", "REVERSED", "TIMEOUT"]);

/**
 * Directed adjacency map: every allowed forward transition. A transition is
 * valid iff `to ∈ ALLOWED_TRANSITIONS[from]`. The `null` case (legacy rows +
 * fresh inserts that have no `state` yet) is handled separately in
 * `isValidTransition` via `NULL_TRANSITIONS` — they can advance to any
 * non-terminal state on the forward path.
 */
const NULL_TRANSITIONS: readonly TxState[] = [
  "INITIATED",
  "PIN_VERIFIED",
  "AML_CHECKED",
  "HOLD_POSTED",
  "PROVIDER_CALLED",
];

const ALLOWED_TRANSITIONS: Record<TxState, readonly TxState[]> = {
  INITIATED: ["PIN_VERIFIED", "AML_CHECKED", "HOLD_POSTED", "PROVIDER_CALLED", "SETTLED", "REVERSED", "TIMEOUT"],
  PIN_VERIFIED: ["AML_CHECKED", "HOLD_POSTED", "PROVIDER_CALLED", "SETTLED", "REVERSED", "TIMEOUT"],
  AML_CHECKED: ["HOLD_POSTED", "PROVIDER_CALLED", "SETTLED", "REVERSED", "TIMEOUT"],
  HOLD_POSTED: ["PROVIDER_CALLED", "SETTLED", "REVERSED", "TIMEOUT"],
  PROVIDER_CALLED: ["SETTLED", "REVERSED", "TIMEOUT"],
  SETTLED: [],
  REVERSED: [],
  TIMEOUT: [],
};

/**
 * Returns true iff `from → to` is an allowed forward transition. A terminal
 * `from` accepts no transitions. `from === null` (legacy row / fresh insert)
 * accepts any non-terminal step on the forward path.
 */
export function isValidTransition(from: TxState | null, to: TxState): boolean {
  // Terminal `from` states never accept any transition.
  if (from !== null && TERMINAL_STATES.has(from)) return false;
  // `to` must be a known state and the pair must be in the adjacency map.
  const allowed = from === null ? NULL_TRANSITIONS : ALLOWED_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * Transition a transaction's `state` to `newState`. Forward-only and
 * optimistic-concurrency-safe (conditional `updateMany WHERE state = ?`).
 *
 * Side effects:
 *   • If `from → to` is invalid (e.g. trying to move SETTLED → REVERSED), the
 *     call is a NO-OP and an INFO audit is written (so the skipped attempt is
 *     traceable). The function resolves normally — it NEVER throws.
 *   • On a successful transition, a WALLET/INFO audit logs the before/after.
 *   • If the row was concurrently modified (another worker transitioned it),
 *     `updateMany` returns count=0 — treated as a no-op, audited at INFO.
 *
 * The audit write is fire-and-forget (audit.ts already swallows its own
 * errors), so a DB hiccup in the audit table can never block this call.
 */
export async function transitionState(transactionId: string, newState: TxState): Promise<void> {
  try {
    const current = await db.transaction.findUnique({
      where: { id: transactionId },
      select: { state: true, reference: true, status: true },
    });
    if (!current) {
      // Row vanished — nothing to transition. No-throw.
      return;
    }

    const fromState: TxState | null = (current.state as TxState | null) ?? null;

    if (!isValidTransition(fromState, newState)) {
      // Invalid (e.g. terminal → anything, or backward). Skip + audit INFO so
      // the attempt is traceable without blocking the financial flow.
      void audit({
        action: "TX_STATE_SKIP",
        category: "WALLET",
        severity: "INFO",
        metadata: { transactionId, reference: current.reference, from: fromState, to: newState, reason: "INVALID_TRANSITION" },
      });
      return;
    }

    // Optimistic-concurrency UPDATE: only flips rows whose `state` still
    // matches what we just read. Two concurrent writers cannot both win.
    const result = await db.transaction.updateMany({
      where: { id: transactionId, state: current.state ?? null },
      data: { state: newState },
    });

    if (result.count === 0) {
      // Concurrent writer got there first. No-op — its transition will be
      // the one recorded.
      void audit({
        action: "TX_STATE_RACE",
        category: "WALLET",
        severity: "INFO",
        metadata: { transactionId, reference: current.reference, from: fromState, attempted: newState, reason: "CONCURRENT_UPDATE" },
      });
      return;
    }

    // Successful transition — record before/after for auditability.
    void audit({
      action: "TX_STATE_TRANSITION",
      category: "WALLET",
      severity: "INFO",
      metadata: { transactionId, reference: current.reference, from: fromState, to: newState, status: current.status },
    });
  } catch (err) {
    // State tracking must NEVER block the financial transaction. Log + swallow.
    void audit({
      action: "TX_STATE_ERROR",
      category: "WALLET",
      severity: "WARN",
      metadata: { transactionId, to: newState, error: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Force a stuck transaction into the TIMEOUT terminal state. Called by the
 * `/api/cron/stuck-transactions` sweeper for rows that have been PENDING for
 * longer than the SLA window (default 2 minutes) with no providerRef.
 *
 * Behavior:
 *   • If the row is already terminal (SETTLED / REVERSED / TIMEOUT), this is
 *     a no-op and returns false.
 *   • Otherwise, atomically sets `state = TIMEOUT` AND `status = FAILED`
 *     (the wallet-facing status the UI relies on) via a single
 *     conditional updateMany, then audits at CRITICAL.
 *   • Returns true iff the row was actually flipped.
 *
 * Like `transitionState`, this NEVER throws — the sweeper loops over many
 * transactions and one failure must not poison the batch.
 */
export async function markTimeout(transactionId: string): Promise<boolean> {
  try {
    const current = await db.transaction.findUnique({
      where: { id: transactionId },
      select: { state: true, status: true, reference: true },
    });
    if (!current) return false;

    const fromState: TxState | null = (current.state as TxState | null) ?? null;

    // Already terminal — nothing to do.
    if (fromState !== null && TERMINAL_STATES.has(fromState)) {
      return false;
    }

    // Force-flip both state + status. Conditional on the row NOT already being
    // in a terminal state (so a concurrent sweeper / settlement cannot be
    // overwritten). The `state IN (...)` filter is the optimistic-concurrency
    // guard.
    const result = await db.transaction.updateMany({
      where: {
        id: transactionId,
        // Only flip rows that are NOT in a terminal state. SQLite cannot do
        // `state NOT IN (NULL, ...)` cleanly, so we list the non-terminal
        // states explicitly + the null case.
        OR: [
          { state: null },
          { state: { in: ["INITIATED", "PIN_VERIFIED", "AML_CHECKED", "HOLD_POSTED", "PROVIDER_CALLED"] } },
        ],
      },
      data: { state: "TIMEOUT", status: "FAILED" },
    });

    if (result.count === 0) {
      return false;
    }

    void audit({
      action: "TX_TIMEOUT",
      category: "WALLET",
      severity: "CRITICAL",
      metadata: {
        transactionId,
        reference: current.reference,
        from: fromState,
        to: "TIMEOUT",
        statusBefore: current.status,
        statusAfter: "FAILED",
        reason: "STUCK_TRANSACTION_SWEEPER",
      },
    });

    return true;
  } catch (err) {
    void audit({
      action: "TX_TIMEOUT_ERROR",
      category: "WALLET",
      severity: "ERROR",
      metadata: { transactionId, error: err instanceof Error ? err.message : String(err) },
    });
    return false;
  }
}
