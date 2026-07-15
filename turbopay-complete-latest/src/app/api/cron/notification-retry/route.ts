import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { notify } from "@/lib/turbocore/notifications";
import { logger, withRequestId } from "@/lib/turbocore/logger";
import { json, errorJson } from "@/lib/turbopay/api";
import { randomUUID } from "node:crypto";

/**
 * CRON — Notification Retry Queue
 * ================================
 *
 * Drains the notification retry queue: picks up NotificationLog entries with
 * `status = "FAILED"` from the last 24h and re-attempts delivery through the
 * active notification provider. After 3 failed retries an entry is marked
 * `PERMANENTLY_FAILED` so the queue stops attempting it. Should be invoked
 * every 15 minutes by an external scheduler.
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
 *       { "path": "/api/cron/notification-retry", "schedule": "0-59/15 * * * *" }
 *     ]
 *   }
 *   Then set CRON_SECRET in the Vercel project env.
 *
 * systemd timer (self-hosted):
 *   /etc/systemd/system/turbopay-cron-notification-retry.service:
 *     [Unit]
 *     Description=Turbopay cron - notification retry queue
 *     [Service]
 *     Type=oneshot
 *     Environment=CRON_SECRET=<secret>
 *     ExecStart=/usr/bin/curl -fsS -H "x-cron-secret: ${CRON_SECRET}" \
 *       https://turbopay.example.com/api/cron/notification-retry
 *   /etc/systemd/system/turbopay-cron-notification-retry.timer:
 *     [Timer]
 *     OnCalendar=*:0/15
 *     Persistent=true
 *   $ systemctl enable --now turbopay-cron-notification-retry.timer
 */

/** Look-back window for retryable failures. */
const RETRY_MAX_AGE_HOURS = 24;

const EFFECTIVE_SECRET = process.env.CRON_SECRET ?? null;

export async function GET(req: Request) {
  const provided = req.headers.get("x-cron-secret");
  if (!EFFECTIVE_SECRET) return errorJson("CRON_SECRET not configured", 500, "CRON_NOT_CONFIGURED");
  if (!provided || !verifyCronSecret(provided, EFFECTIVE_SECRET)) {
    return errorJson("Unauthorized", 401, "CRON_UNAUTHORIZED");
  }

  const requestId = randomUUID();
  return withRequestId(requestId, async () => {
    // Leader election — only one instance runs this cron at a time.
    const lock = await acquireCronLock("notification-retry", 120_000);
    if (!lock) return json({ data: { skipped: true, reason: "already_running" } });

    logger.info("cron.notification-retry.start", { maxAgeHours: RETRY_MAX_AGE_HOURS });

    try {
      const result = await notify.retryFailed(RETRY_MAX_AGE_HOURS);
      logger.info("cron.notification-retry.done", {
        retried: result.retried,
        succeeded: result.succeeded,
        failed: result.failed,
        permanentlyFailed: result.permanentlyFailed,
      });
      return json({ data: result });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("cron.notification-retry.fatal", { error: message });
      return errorJson("Notification retry run failed", 500, "CRON_FATAL", { error: message });
    } finally {
      await releaseCronLock(lock);
    }
  });
}
