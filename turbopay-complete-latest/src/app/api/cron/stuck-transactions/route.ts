import { db } from "@/lib/db";
import { markTimeout } from "@/lib/turbopay/tx-state";
import { reverseEntry, LedgerError } from "@/lib/turbopay/ledger";
import { audit } from "@/lib/turbopay/audit";
import { settlementService } from "@/lib/turbopay/services/settlement.service";
import { logger, withRequestId } from "@/lib/turbocore/logger";
import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { json, errorJson } from "@/lib/turbopay/api";
import { randomUUID } from "node:crypto";

/**
 * CRON — Stuck Transaction Sweeper
 * =================================
 *
 * Detects transactions that have been PENDING for longer than the SLA window
 * (default 2 minutes) — these are rows where the orchestrator crashed between
 * hold-post and confirm/reverse, leaving the user's wallet debited but the
 * Transaction row stuck in PENDING.
 *
 * Resolution policy (per task spec):
 *   • No providerRef  → the provider call never returned a reference (or was
 *     never made). SAFE to reverse: mark state=TIMEOUT + status=FAILED +
 *     post an opposing ledger leg (credit back the wallet). No stranded funds.
 *   • providerRef exists → the provider call returned a reference but the
 *     confirm step crashed. We CANNOT safely reverse without a provider
 *     status-check API (the provider may have actually settled the bill /
 *     delivered the airtime). ENQUEUE into the SettlementQueue so the
 *     settlement worker can run the provider status check on the next tick
 *     (every 5 min). The worker will confirm, reverse, or retry with
 *     exponential backoff based on the provider's response.
 *
 * Should be invoked every 5 minutes by an external scheduler.
 *
 * Auth: the `x-cron-secret` header must match `process.env.CRON_SECRET`.
 * If `CRON_SECRET` is unset, the route falls back to "dev-cron-secret" and
 * logs a warning (dev-only convenience — production MUST set CRON_SECRET).
 *
 * ─── Scheduler wiring ────────────────────────────────────────────
 *
 * Vercel Cron (vercel.json):
 *   {
 *     "crons": [
 *       { "path": "/api/cron/stuck-transactions", "schedule": "0-59/5 * * * *" }
 *     ]
 *   }
 *   Then set CRON_SECRET in the Vercel project env.
 *
 * systemd timer (self-hosted):
 *   /etc/systemd/system/turbopay-cron-stuck.service:
 *     [Unit]
 *     Description=Turbopay cron — stuck transaction sweeper
 *     [Service]
 *     Type=oneshot
 *     Environment=CRON_SECRET=<secret>
 *     ExecStart=/usr/bin/curl -fsS -H "x-cron-secret: <secret>" \
 *       https://turbopay.example.com/api/cron/stuck-transactions
 *   /etc/systemd/system/turbopay-cron-stuck.timer:
 *     [Timer]
 *     OnCalendar=*:0/5
 *     Persistent=true
 *   $ systemctl enable --now turbopay-cron-stuck.timer
 */

const EFFECTIVE_SECRET = process.env.CRON_SECRET ?? null;

/** A PENDING transaction older than this is considered stuck. */
const STUCK_SLA_MS = 2 * 60 * 1000; // 2 minutes

export async function GET(req: Request) {
  // Auth check.
  const provided = req.headers.get("x-cron-secret");
  if (!EFFECTIVE_SECRET) return errorJson("CRON_SECRET not configured", 500, "CRON_NOT_CONFIGURED");
  if (!provided || !verifyCronSecret(provided, EFFECTIVE_SECRET)) {
    return errorJson("Unauthorized", 401, "CRON_UNAUTHORIZED");
  }

  const requestId = randomUUID();
  return withRequestId(requestId, async () => {
    // ─── Leader election ────────────────────────────────────────
    const lock = await acquireCronLock("stuck-transactions", 110_000);
    if (!lock) {
      return json({ data: { skipped: true, reason: "already_running_on_another_instance" } });
    }

    logger.info("cron.stuck-transactions.start", {});

    try {
      const cutoff = new Date(Date.now() - STUCK_SLA_MS);

      // Find PENDING transactions older than the SLA window. These are rows
      // where the orchestrator crashed between hold-post and confirm/reverse.
      const stuck = await db.transaction.findMany({
        where: { status: "PENDING", createdAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          reference: true,
          userId: true,
          walletId: true,
          providerRef: true,
          metadata: true,
          state: true,
          type: true,
          amountKobo: true,
          createdAt: true,
        },
        take: 100, // cap per run so a single tick can't overrun its budget
      });

      let resolved = 0;
      let reversed = 0;
      let unresolved = 0;

      for (const tx of stuck) {
        // Defensive: skip rows that are already terminal (concurrent settlement
        // / reversal may have flipped them between our findMany and now).
        const state = tx.state;
        if (state === "SETTLED" || state === "REVERSED" || state === "TIMEOUT") {
          continue;
        }

        // ── Case A: no providerRef → the provider call never returned a
        // reference (or was never made). SAFE to reverse: mark TIMEOUT +
        // FAILED, then post an opposing ledger leg to credit the wallet back.
        if (!tx.providerRef) {
          // Parse the original hold-debit ledgerEntryId from metadata so we
          // can post the opposing reversal leg.
          let ledgerEntryId: string | null = null;
          try {
            const meta = tx.metadata ? (JSON.parse(tx.metadata) as Record<string, unknown>) : {};
            if (typeof meta.ledgerEntryId === "string") ledgerEntryId = meta.ledgerEntryId;
          } catch {
            // Corrupt metadata — handled below as a non-reversible case.
          }

          if (!ledgerEntryId) {
            // No ledgerEntryId to reverse — cannot safely credit the wallet.
            // Audit CRITICAL so an operator can investigate manually.
            unresolved++;
            void audit({
              userId: tx.userId,
              action: "STUCK_TX_UNREVERSIBLE",
              category: "WALLET",
              severity: "CRITICAL",
              metadata: {
                transactionId: tx.id,
                reference: tx.reference,
                reason: "NO_LEDGER_ENTRY_ID_IN_METADATA",
                state: tx.state,
                amountKobo: tx.amountKobo,
              },
            });
            continue;
          }

          // Force-flip state + status to TIMEOUT/FAILED. If a concurrent
          // confirm/reverse beat us to it, markTimeout returns false and we
          // skip the ledger reversal (the wallet has already been adjusted).
          const flipped = await markTimeout(tx.id);
          if (!flipped) {
            // Concurrent writer resolved it — leave for the next tick.
            continue;
          }

          // Post the opposing ledger leg to credit the wallet back. Wrap in
          // try/catch so a ledger failure cannot poison the loop for the
          // remaining stuck txs (the state flip already happened, so the row
            // is terminal — an operator can finish the reversal manually).
          try {
            await reverseEntry(ledgerEntryId, {
              description: `Auto-reversal: stuck transaction ${tx.reference} (no providerRef after SLA)`,
              refId: tx.id,
            });
            reversed++;
            void audit({
              userId: tx.userId,
              action: "STUCK_TX_REVERSED",
              category: "WALLET",
              severity: "WARN",
              metadata: {
                transactionId: tx.id,
                reference: tx.reference,
                ledgerEntryId,
                amountKobo: tx.amountKobo,
                stateBefore: tx.state,
              },
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            unresolved++;
            void audit({
              userId: tx.userId,
              action: "STUCK_TX_REVERSAL_FAILED",
              category: "WALLET",
              severity: "CRITICAL",
              metadata: {
                transactionId: tx.id,
                reference: tx.reference,
                ledgerEntryId,
                error: message,
                code: e instanceof LedgerError ? e.code : undefined,
              },
            });
          }
          resolved++;
          continue;
        }

        // ── Case B: providerRef exists → the provider call returned a
        // reference but the confirm step crashed. We CANNOT safely reverse
        // without a provider status-check API (the provider may have
        // actually settled the bill / delivered the airtime). ENQUEUE into
        // the SettlementQueue so the settlement worker can run the provider
        // status check on the next tick (every 5 min). The enqueue is
        // idempotent — calling it on every sweeper tick produces a single
        // SettlementQueue row per transaction.
        unresolved++;
        await settlementService.enqueue(
          tx.id,
          tx.providerRef,
          "STUCK_TX_PROVIDER_REF_PRESENT",
        ).catch(() => null);
        void audit({
          userId: tx.userId,
          action: "STUCK_TX_PROVIDER_REF_PRESENT",
          category: "WALLET",
          severity: "CRITICAL",
          metadata: {
            transactionId: tx.id,
            reference: tx.reference,
            providerRef: tx.providerRef,
            state: tx.state,
            amountKobo: tx.amountKobo,
            type: tx.type,
            reason: "ENQUEUED_FOR_SETTLEMENT_WORKER",
            ageMs: Date.now() - new Date(tx.createdAt ?? Date.now()).getTime(),
          },
        });
      }

      const checked = stuck.length;
      logger.info("cron.stuck-transactions.done", { checked, resolved, reversed, unresolved });
      return json({ data: { checked, resolved, reversed, unresolved } });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("cron.stuck-transactions.fatal", { error: message });
      return errorJson("Stuck-transaction sweep failed", 500, "CRON_FATAL", { error: message });
    } finally {
      await releaseCronLock(lock);
    }
  });
}
