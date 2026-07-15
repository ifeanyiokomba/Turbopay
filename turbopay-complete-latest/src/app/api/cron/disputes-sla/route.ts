import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { disputes } from "@/lib/turbocore/disputes";
import { logger, withRequestId } from "@/lib/turbocore/logger";
import { json, errorJson } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { randomUUID } from "node:crypto";

/**
 * CRON — Disputes SLA Breach Checker
 * ==================================
 *
 * Scans OPEN / UNDER_REVIEW / EVIDENCE_REQUIRED disputes whose `slaDueAt` has
 * passed and flags them. Each breached dispute is escalated to URGENT priority
 * (so it surfaces at the top of the admin queue) and audit-logged so ops has
 * a record of when SLA was breached — required for NDPR / CBN complaint
 * tracking.
 *
 * Recommended schedule: every hour (CBN guidelines require acknowledging
 * complaints within 24h and resolving within 72h for most priorities; running
 * hourly catches breaches early).
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
 *       { "path": "/api/cron/disputes-sla", "schedule": "0 * * * *" }
 *     ]
 *   }
 *   Then set CRON_SECRET in the Vercel project env.
 *
 * systemd timer (self-hosted):
 *   /etc/systemd/system/turbopay-cron-disputes-sla.service:
 *     [Unit]
 *     Description=Turbopay cron - disputes SLA breach checker
 *     [Service]
 *     Type=oneshot
 *     Environment=CRON_SECRET=<secret>
 *     ExecStart=/usr/bin/curl -fsS -H "x-cron-secret: <secret>" \
 *       https://turbopay.example.com/api/cron/disputes-sla
 *   /etc/systemd/system/turbopay-cron-disputes-sla.timer:
 *     [Timer]
 *     OnCalendar=hourly
 *     Persistent=true
 *   $ systemctl enable --now turbopay-cron-disputes-sla.timer
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
    const lock = await acquireCronLock("disputes-sla", 120_000);
    if (!lock) return json({ data: { skipped: true, reason: "already_running" } });

    logger.info("cron.disputes-sla.start", {});

    try {
      const breached = await disputes.checkSlaBreaches();
      logger.info("cron.disputes-sla.breached", { count: breached.length });

      // Escalate each breached dispute to URGENT + audit-log the breach.
      // The status is preserved (we only escalate priority) so the dispute
      // stays in its current workflow state but bubbles to the top of the
      // admin queue.
      for (const d of breached) {
        try {
          await disputes.update(
            d.id,
            { priority: "URGENT" },
            { id: "system-cron", name: "Disputes SLA Cron" },
          );
          await audit({
            userId: d.userId,
            action: "DISPUTE_SLA_BREACHED",
            category: "ADMIN",
            severity: "WARN",
            metadata: {
              disputeId: d.id,
              disputeNumber: d.disputeNumber,
              slaDueAt: d.slaDueAt?.toISOString() ?? null,
              originalPriority: d.priority,
              escalatedTo: "URGENT",
            },
          });
        } catch (e: unknown) {
          // A single dispute failure shouldn't abort the whole cron run.
          const message = e instanceof Error ? e.message : String(e);
          logger.error("cron.disputes-sla.escalate-failed", { disputeId: d.id, error: message });
        }
      }

      logger.info("cron.disputes-sla.done", { processed: breached.length, breached: breached.length });
      return json({ data: { processed: breached.length, breached: breached.length, disputeIds: breached.map((b) => b.id) } });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("cron.disputes-sla.fatal", { error: message });
      return errorJson("Cron run failed", 500, "CRON_FATAL", { error: message });
    } finally {
      await releaseCronLock(lock);
    }
  });
}
