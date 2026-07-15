import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { settlementService } from "@/lib/turbopay/services/settlement.service";
import { logger, withRequestId } from "@/lib/turbocore/logger";
import { json, errorJson } from "@/lib/turbopay/api";
import { randomUUID } from "node:crypto";

/**
 * CRON — Settlement Worker
 * =========================
 *
 * Drains the SettlementQueue — failed external transfers awaiting retry.
 * Picks up PENDING / RETRYING rows whose `nextRetryAt` has elapsed and
 * reconciles them by querying the provider for the transfer status.
 *
 *   • If a `providerRef` exists → query the provider for the transfer status.
 *       SUCCESS → confirm the Transaction + mark SETTLED.
 *       FAILED  → reverse the ledger entry + mark FAILED.
 *       PENDING → increment attempts, set nextRetryAt with exponential backoff.
 *   • If no `providerRef` → increment attempts + backoff. After `maxAttempts`,
 *     mark FAILED. The stuck-transaction sweeper handles the actual ledger
 *     reversal for the no-providerRef case.
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
 *       { "path": "/api/cron/settlement-worker", "schedule": "0-59/5 * * * *" }
 *     ]
 *   }
 *   Then set CRON_SECRET in the Vercel project env.
 *
 * systemd timer (self-hosted):
 *   /etc/systemd/system/turbopay-cron-settlement.service:
 *     [Unit]
 *     Description=Turbopay cron — settlement worker
 *     [Service]
 *     Type=oneshot
 *     Environment=CRON_SECRET=<secret>
 *     ExecStart=/usr/bin/curl -fsS -H "x-cron-secret: <secret>" \
 *       https://turbopay.example.com/api/cron/settlement-worker
 *   /etc/systemd/system/turbopay-cron-settlement.timer:
 *     [Timer]
 *     OnCalendar=*:0/5
 *     Persistent=true
 *   $ systemctl enable --now turbopay-cron-settlement.timer
 *
 * ─── Coordination with the stuck-transaction sweeper ─────────────
 *
 * The stuck-transaction sweeper (`/api/cron/stuck-transactions`, also every
 * 5 min) is the authoritative path for the no-providerRef case (safe to
 * reverse). When the sweeper finds a stuck row WITH a providerRef, it now
 * ENQUEUES it into the SettlementQueue (instead of just auditing CRITICAL)
 * so this worker can run the provider status check on the next tick. The
 * two workers are complementary — they don't double-process the same row
 * (the settlement worker's claim uses a conditional updateMany as a
 * distributed lock, and the sweeper's enqueue is idempotent).
 */

const EFFECTIVE_SECRET = process.env.CRON_SECRET ?? null;

export async function GET(req: Request) {
  // Auth check.
  const provided = req.headers.get("x-cron-secret");
  if (!EFFECTIVE_SECRET) return errorJson("CRON_SECRET not configured", 500, "CRON_NOT_CONFIGURED");
  if (!provided || !verifyCronSecret(provided, EFFECTIVE_SECRET)) {
    return errorJson("Unauthorized", 401, "CRON_UNAUTHORIZED");
  }

  const requestId = randomUUID();
  return withRequestId(requestId, async () => {
    // Leader election — only one instance runs this cron at a time.
    const lock = await acquireCronLock("settlement-worker", 120_000);
    if (!lock) return json({ data: { skipped: true, reason: "already_running" } });

    logger.info("cron.settlement-worker.start", {});

    try {
      const result = await settlementService.processBatch(10);
      logger.info("cron.settlement-worker.done", { ...result });
      return json({ data: result });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("cron.settlement-worker.fatal", { error: message });
      return errorJson("Settlement worker failed", 500, "CRON_FATAL", { error: message });
    } finally {
      await releaseCronLock(lock);
    }
  });
}
