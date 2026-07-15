import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { cleanupExpiredSessions, AUDIT_RETENTION_DAYS } from "@/lib/turbopay/auth";
import { logger, withRequestId } from "@/lib/turbocore/logger";
import { json, errorJson } from "@/lib/turbopay/api";
import { randomUUID } from "node:crypto";

/**
 * CRON — Session Cleanup
 * ========================
 *
 * Periodically deletes Session rows that are no longer usable for
 * authentication OR retained for audit:
 *
 *   1. Expired sessions — access token expired AND refresh token expired
 *      (or never issued). These can't authenticate OR refresh.
 *   2. Old revoked sessions — `revokedAt` older than
 *      `AUDIT_RETENTION_DAYS` (7 days). Kept for the audit trail for 7
 *      days, then pruned.
 *
 * Returns `{ deleted, remaining }`. `remaining` is the total Session row
 * count AFTER the cleanup — a steadily-growing `remaining` indicates a
 * session leak (sessions created but never expired/revoked).
 *
 * Auth: the `x-cron-secret` header must match `process.env.CRON_SECRET`.
 * If `CRON_SECRET` is unset, the route falls back to "dev-cron-secret" and
 * logs a warning (dev-only convenience — production MUST set CRON_SECRET).
 *
 * ─── Scheduler wiring ────────────────────────────────────────────
 *
 * Recommended schedule: DAILY at 03:00 local time. Off-peak hour so the
 * deleteMany doesn't contend with login traffic; daily is frequent enough
 * that the dead-session row count never grows large (each cleanup is a
 * single DELETE, regardless of how many rows match).
 *
 * Vercel Cron (vercel.json):
 *   {
 *     "crons": [
 *       { "path": "/api/cron/session-cleanup", "schedule": "0 3 * * *" }
 *     ]
 *   }
 *   Then set CRON_SECRET in the Vercel project env.
 *
 * systemd timer (self-hosted):
 *   /etc/systemd/system/turbopay-cron-session-cleanup.service:
 *     [Unit]
 *     Description=Turbopay cron — session cleanup
 *     [Service]
 *     Type=oneshot
 *     Environment=CRON_SECRET=<secret>
 *     ExecStart=/usr/bin/curl -fsS -H "x-cron-secret: ${CRON_SECRET}" \
 *       https://turbopay.example.com/api/cron/session-cleanup
 *   /etc/systemd/system/turbopay-cron-session-cleanup.timer:
 *     [Timer]
 *     OnCalendar=*-*-* 03:00:00
 *     Persistent=true
 *   $ systemctl enable --now turbopay-cron-session-cleanup.timer
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
    const lock = await acquireCronLock("session-cleanup", 120_000);
    if (!lock) return json({ data: { skipped: true, reason: "already_running" } });

    logger.info("cron.session-cleanup.start", {});

    try {
      const { deleted, remaining } = await cleanupExpiredSessions();
      logger.info("cron.session-cleanup.done", {
        deleted,
        remaining,
        retentionDays: AUDIT_RETENTION_DAYS,
      });
      return json({ data: { deleted, remaining } });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("cron.session-cleanup.fatal", { error: message });
      return errorJson("Session cleanup failed", 500, "CRON_FATAL", { error: message });
    } finally {
      await releaseCronLock(lock);
    }
  });
}
