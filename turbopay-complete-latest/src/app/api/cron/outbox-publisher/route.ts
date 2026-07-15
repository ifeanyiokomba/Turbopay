import { outbox } from "@/lib/turbocore/outbox";
import { logger, withRequestId } from "@/lib/turbocore/logger";
import { json, errorJson } from "@/lib/turbopay/api";
import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { randomUUID } from "node:crypto";

/**
 * CRON — Transactional Outbox Publisher
 * ======================================
 *
 * Drains the `OutboxEvent` table. Picks up PENDING rows (oldest first),
 * publishes each via the TurboCore event bus, and marks the row PUBLISHED or
 * FAILED. Should be invoked every 1 minute by an external scheduler.
 *
 * Why this exists: when a payment succeeds, an `OutboxEvent` row is written
 * INSIDE the same Prisma transaction as the ledger post + transaction status
 * flip. This guarantees the event is persisted if and only if the tx commits
 * — eliminating the dual-write window where the DB state changes but the
 * event-bus publish is lost (e.g. process crash between commit + publish).
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
 *       { "path": "/api/cron/outbox-publisher", "schedule": "* * * * *" }
 *     ]
 *   }
 *
 * systemd timer (self-hosted):
 *   /etc/systemd/system/turbopay-cron-outbox.service:
 *     [Unit]
 *     Description=Turbopay cron — transactional outbox publisher
 *     [Service]
 *     Type=oneshot
 *     Environment=CRON_SECRET=<secret>
 *     ExecStart=/usr/bin/curl -fsS -H "x-cron-secret: <secret>" \
 *       https://turbopay.example.com/api/cron/outbox-publisher
 *   /etc/systemd/system/turbopay-cron-outbox.timer:
 *     [Timer]
 *     OnCalendar=*:0/1
 *     Persistent=true
 *   $ systemctl enable --now turbopay-cron-outbox.timer
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
    // ─── Leader election ────────────────────────────────────────
    const lock = await acquireCronLock("outbox-publisher", 50_000);
    if (!lock) {
      return json({ data: { skipped: true, reason: "already_running_on_another_instance" } });
    }

    try {
      logger.info("cron.outbox-publisher.start", {});

      const result = await outbox.processPending(50);
      logger.info("cron.outbox-publisher.done", {
        processed: result.processed,
        published: result.published,
        failed: result.failed,
      });
      return json({ data: result });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("cron.outbox-publisher.fatal", { error: message });
      return errorJson("Outbox publisher run failed", 500, "CRON_FATAL", { error: message });
    } finally {
      await releaseCronLock(lock);
    }
  });
}
