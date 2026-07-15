import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { reconciliation } from "@/lib/turbocore/reconciliation";
import { logger, withRequestId } from "@/lib/turbocore/logger";
import { json, errorJson } from "@/lib/turbopay/api";
import { randomUUID } from "node:crypto";

/**
 * CRON — Daily Reconciliation
 * ============================
 *
 * Runs the full reconciliation engine: scans every wallet, compares its
 * cached `balanceKobo` against the ledger sum (source of truth), and
 * corrects any drift. Should be invoked once per day by an external
 * scheduler.
 *
 * Auth: the `x-cron-secret` header must match `process.env.CRON_SECRET`.
 * In production, if `CRON_SECRET` is unset the route returns 500 (no fallback).
 * In dev only (`NODE_ENV !== "production"`), it falls back to "dev-cron-secret"
 * so the scheduler can run without configuring a secret.
 *
 * ─── Scheduler wiring ────────────────────────────────────────────
 *
 * Vercel Cron (vercel.json):
 *   {
 *     "crons": [
 *       { "path": "/api/cron/reconciliation", "schedule": "0 3 * * *" }
 *     ]
 *   }
 *   Then set CRON_SECRET in the Vercel project env.
 *
 * systemd timer (self-hosted):
 *   /etc/systemd/system/turbopay-cron-reconciliation.service:
 *     [Unit]
 *     Description=Turbopay cron — daily reconciliation
 *     [Service]
 *     Type=oneshot
 *     Environment=CRON_SECRET=<secret>
 *     ExecStart=/usr/bin/curl -fsS -H "x-cron-secret: ${CRON_SECRET}" \
 *       https://turbopay.example.com/api/cron/reconciliation
 *   /etc/systemd/system/turbopay-cron-reconciliation.timer:
 *     [Timer]
 *     OnCalendar=*-*-* 03:00:00
 *     Persistent=true
 *   $ systemctl enable --now turbopay-cron-reconciliation.timer
 */

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
    const lock = await acquireCronLock("reconciliation", 120_000);
    if (!lock) return json({ data: { skipped: true, reason: "already_running" } });

    logger.info("cron.reconciliation.start", {});

    try {
      const result = await reconciliation.runAll("DAILY");
      logger.info("cron.reconciliation.done", {
        runId: result.runId,
        walletsChecked: result.walletsChecked,
        driftDetected: result.driftDetected,
        driftCorrected: result.driftCorrected,
      });
      // Map driftCorrected → corrected to match the documented response shape.
      return json({
        data: {
          runId: result.runId,
          walletsChecked: result.walletsChecked,
          driftDetected: result.driftDetected,
          corrected: result.driftCorrected,
        },
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("cron.reconciliation.fatal", { error: message });
      return errorJson("Reconciliation run failed", 500, "CRON_FATAL", { error: message });
    } finally {
      await releaseCronLock(lock);
    }
  });
}
