import { processBatch } from "@/lib/turbocore/queue";
import { logger, withRequestId } from "@/lib/turbocore/logger";
import { json, errorJson } from "@/lib/turbopay/api";
import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { randomUUID } from "node:crypto";

/**
 * CRON — Async Task Queue Worker
 * ===============================
 *
 * Drains the durable side-effect queue (`AsyncTask` table). Picks up
 * PENDING NOTIFY / CASHBACK / EVENT tasks, claims each via a conditional
 * `updateMany` (PENDING → PROCESSING), invokes the handler, and marks the
 * row COMPLETED or schedules a retry. Should be invoked every 1 minute by
 * an external scheduler.
 *
 * Why this exists: financial routes (transfer, airtime, bills) enqueue
 * fire-and-forget tasks here instead of calling `notify.sendInApp` /
 * `rewards.awardCashback` inline — so a slow notification provider or a
 * rewards-service hiccup can NEVER block or fail a payment.
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
 *       { "path": "/api/cron/queue-worker", "schedule": "* * * * *" }
 *     ]
 *   }
 *   Then set CRON_SECRET in the Vercel project env.
 *
 * systemd timer (self-hosted):
 *   /etc/systemd/system/turbopay-cron-queue.service:
 *     [Unit]
 *     Description=Turbopay cron — async task queue worker
 *     [Service]
 *     Type=oneshot
 *     Environment=CRON_SECRET=<secret>
 *     ExecStart=/usr/bin/curl -fsS -H "x-cron-secret: <secret>" \
 *       https://turbopay.example.com/api/cron/queue-worker
 *   /etc/systemd/system/turbopay-cron-queue.timer:
 *     [Timer]
 *     OnCalendar=*:0/1
 *     Persistent=true
 *   $ systemctl enable --now turbopay-cron-queue.timer
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
    const lock = await acquireCronLock("queue-worker", 120_000);
    if (!lock) return json({ data: { skipped: true, reason: "already_running" } });

    logger.info("cron.queue-worker.start", {});

    try {
      // Drain up to 20 tasks per type (NOTIFY + CASHBACK). Each task is
      // claimed via a conditional updateMany so concurrent workers can run
      // safely in parallel.
      const result = await processBatch(20);
      logger.info("cron.queue-worker.done", { processed: result.processed });
      return json({ data: { processed: result.processed } });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("cron.queue-worker.fatal", { error: message });
      return errorJson("Queue worker run failed", 500, "CRON_FATAL", { error: message });
    } finally {
      await releaseCronLock(lock);
    }
  });
}
