import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { billswift } from "@/lib/turbocore/billswift";
import { logger, withRequestId } from "@/lib/turbocore/logger";
import { json, errorJson } from "@/lib/turbopay/api";
import { randomUUID } from "node:crypto";

/**
 * CRON — BillSwift Bulk Job Runner
 * =================================
 *
 * Picks up PENDING items across all BillSwift bulk jobs and fulfils them
 * through `billswift.processNextBulkItem()` (which delegates to
 * `executeProviderDebit` → atomic hold + provider call + confirm/reverse).
 *
 * Auth: the `x-cron-secret` header must match `process.env.CRON_SECRET`.
 * If `CRON_SECRET` is unset, the route falls back to "dev-cron-secret" and
 * logs a warning (dev-only convenience — production MUST set CRON_SECRET).
 *
 * Each run processes up to `MAX_ITEMS_PER_RUN` (50) items to stay well under
 * the Vercel/Next.js serverless function timeout. If more items remain, the
 * next cron tick will pick them up — items are picked in `rowIndex` order so
 * progress is monotonic and fair across jobs.
 *
 * ─── Scheduler wiring ────────────────────────────────────────────
 *
 * Vercel Cron (vercel.json):
 *   {
 *     "crons": [
 *       { "path": "/api/cron/billswift-bulk", "schedule": "0-59/5 * * * *" }
 *     ]
 *   }
 *   Then set CRON_SECRET in the Vercel project env.
 *
 * systemd timer (self-hosted):
 *   /etc/systemd/system/turbopay-cron-billswift.service:
 *     [Unit]
 *     Description=Turbopay cron - BillSwift bulk job runner
 *     [Service]
 *     Type=oneshot
 *     Environment=CRON_SECRET=<secret>
 *     ExecStart=/usr/bin/curl -fsS -H "x-cron-secret: <secret>" \
 *       https://turbopay.example.com/api/cron/billswift-bulk
 *   /etc/systemd/system/turbopay-cron-billswift.timer:
 *     [Timer]
 *     OnCalendar=*:0/5
 *     Persistent=true
 *   $ systemctl enable --now turbopay-cron-billswift.timer
 */

/** Hard cap on items processed per cron invocation (timeout safety). */
const MAX_ITEMS_PER_RUN = 50;

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
    const lock = await acquireCronLock("billswift-bulk", 120_000);
    if (!lock) return json({ data: { skipped: true, reason: "already_running" } });

    logger.info("cron.billswift-bulk.start", { maxItems: MAX_ITEMS_PER_RUN });
    const errors: Array<{ itemId?: string; jobId?: string; error: string }> = [];
    let processed = 0;
    let succeeded = 0;

    try {
      // Loop: each call to processNextBulkItem() handles ONE item (across all
      // jobs, in rowIndex order). Stop when the service reports no pending
      // items OR we hit the per-run cap.
      for (let i = 0; i < MAX_ITEMS_PER_RUN; i++) {
        const result = await billswift.processNextBulkItem();
        if (!result.processed) {
          // No more PENDING items — done for this run.
          break;
        }
        processed++;
        if (result.success) {
          succeeded++;
        } else {
          errors.push({
            itemId: result.itemId,
            jobId: result.jobId,
            error: result.error ?? "UNKNOWN",
          });
        }
      }

      logger.info("cron.billswift-bulk.done", {
        processed,
        succeeded,
        errorCount: errors.length,
      });
      return json({ data: { processed, succeeded, errors } });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("cron.billswift-bulk.fatal", { error: message });
      return errorJson("Cron run failed", 500, "CRON_FATAL", { error: message });
    } finally {
      await releaseCronLock(lock);
    }
  });
}
