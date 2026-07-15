import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { scheduledPayments } from "@/lib/turbocore/scheduled-payments";
import { logger, withRequestId } from "@/lib/turbocore/logger";
import { json, errorJson } from "@/lib/turbopay/api";
import { randomUUID } from "node:crypto";

/**
 * CRON — Scheduled Payments Runner
 * =================================
 *
 * Picks up ACTIVE scheduled payments whose `nextExecutionAt` is due and
 * processes them via `scheduledPayments.execute()`. Should be invoked every
 * 5 minutes by an external scheduler.
 *
 * Auth: the `x-cron-secret` header must match `process.env.CRON_SECRET`.
 * If `CRON_SECRET` is unset, the route falls back to "dev-cron-secret" and
 * logs a warning (dev-only convenience — production MUST set CRON_SECRET).
 *
 * Service-account model: each scheduled payment was pre-authorized by the
 * user (with PIN) at creation time, so `execute()` does NOT need a PIN.
 * AML still runs.
 *
 * Safety: every execution is wrapped in try/catch — one failure cannot
 * block other due payments. Idempotency, amount cap, and pre-flight
 * balance checks are enforced inside `execute()`.
 *
 * ─── Scheduler wiring ────────────────────────────────────────────
 *
 * Vercel Cron (vercel.json):
 *   {
 *     "crons": [
 *       { "path": "/api/cron/scheduled-payments", "schedule": "0-59/5 * * * *" }
 *     ]
 *   }
 *   Then set CRON_SECRET in the Vercel project env.
 *
 * systemd timer (self-hosted):
 *   /etc/systemd/system/turbopay-cron-scheduled.service:
 *     [Unit]
 *     Description=Turbopay cron - scheduled payments
 *     [Service]
 *     Type=oneshot
 *     Environment=CRON_SECRET=<secret>
 *     ExecStart=/usr/bin/curl -fsS -H "x-cron-secret: <secret>" \
 *       https://turbopay.example.com/api/cron/scheduled-payments
 *   /etc/systemd/system/turbopay-cron-scheduled.timer:
 *     [Timer]
 *     OnCalendar=*:0/5
 *     Persistent=true
 *   $ systemctl enable --now turbopay-cron-scheduled.timer
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
    const lock = await acquireCronLock("scheduled-payments", 120_000);
    if (!lock) return json({ data: { skipped: true, reason: "already_running" } });

    logger.info("cron.scheduled-payments.start", {});
    const errors: Array<{ id: string; error: string }> = [];
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      const due = await scheduledPayments.findDue();
      logger.info("cron.scheduled-payments.due", { count: due.length });

      for (const sp of due) {
        processed++;
        try {
          const result = await scheduledPayments.execute(sp);

          if (result.success) {
            succeeded++;
          } else {
            failed++;
            errors.push({ id: sp.id, error: result.error ?? "Execution failed" });
          }

          // Idempotency skips leave the row untouched — do NOT call
          // markExecuted (which would bump failureCount and could flip
          // status). All other outcomes (success OR controlled failure)
          // advance the schedule via markExecuted.
          if (!result.skipped) {
            await scheduledPayments.markExecuted(sp.id, result.success, result.error);
          }
        } catch (e: unknown) {
          // Defensive: execute() catches its own errors, but a crash here
          // must not poison the loop for the remaining due payments.
          const message = e instanceof Error ? e.message : String(e);
          failed++;
          errors.push({ id: sp.id, error: message });
          await scheduledPayments.markExecuted(sp.id, false, message);
        }
      }

      logger.info("cron.scheduled-payments.done", { processed, succeeded, failed, errorCount: errors.length });
      return json({ data: { processed, succeeded, failed, errors } });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("cron.scheduled-payments.fatal", { error: message });
      return errorJson("Cron run failed", 500, "CRON_FATAL", { error: message, processed, succeeded, failed });
    } finally {
      await releaseCronLock(lock);
    }
  });
}
