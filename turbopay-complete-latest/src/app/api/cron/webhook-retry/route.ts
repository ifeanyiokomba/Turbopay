import { db } from "@/lib/db";
import { webhookRegistry } from "@/lib/turbocore/webhooks/registry";
import "@/lib/turbocore/webhooks/dispatcher";
import { audit } from "@/lib/turbopay/audit";
import { json, errorJson } from "@/lib/turbopay/api";
import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { logger } from "@/lib/turbocore/logger";

/**
 * Cron: Webhook Retry Worker
 * ============================
 *
 * GET /api/cron/webhook-retry  (Vercel Cron sends GET, not POST)
 *
 * Runs every 5 minutes. Picks up FAILED webhook events from the last 24 hours
 * and re-processes them through the registry's reprocess() method, which
 * re-normalizes the payload AND re-dispatches to the business layer.
 *
 * Leader election: acquires a DB lock so only ONE instance runs this cron at
 * a time — prevents duplicate re-processing when multiple instances are behind
 * a load balancer.
 *
 * Auth: x-cron-secret header (CRON_SECRET env var).
 */
const MAX_EVENTS_PER_RUN = 10;
const RETENTION_WINDOW_HOURS = 24;
const LOCK_TTL_MS = 4 * 60 * 1000; // 4 min — shorter than the 5-min interval

const EFFECTIVE_SECRET = process.env.CRON_SECRET ?? null;

export async function GET(req: Request) {
  const provided = req.headers.get("x-cron-secret");
  if (!EFFECTIVE_SECRET) return errorJson("CRON_SECRET not configured", 500, "CRON_NOT_CONFIGURED");
  if (!provided || !verifyCronSecret(provided, EFFECTIVE_SECRET)) {
    return errorJson("Unauthorized", 401, "CRON_UNAUTHORIZED");
  }

  // ─── Leader election ──────────────────────────────────────────
  const lock = await acquireCronLock("webhook-retry", LOCK_TTL_MS);
  if (!lock) {
    return json({ data: { skipped: true, reason: "already_running_on_another_instance" } });
  }

  try {
    const since = new Date(Date.now() - RETENTION_WINDOW_HOURS * 60 * 60 * 1000);
    const failedEvents = await db.webhookEvent.findMany({
      where: { status: "FAILED", receivedAt: { gte: since } },
      orderBy: { receivedAt: "asc" },
      take: MAX_EVENTS_PER_RUN,
    });

    if (failedEvents.length === 0) {
      return json({ data: { retried: 0, message: "No failed events to retry" } });
    }

    let succeeded = 0;
    let stillFailing = 0;

    for (const event of failedEvents) {
      try {
        const parsedPayload = JSON.parse(event.payload);

        // Re-normalize + RE-DISPATCH via the registry's reprocess method.
        const result = await webhookRegistry.reprocess(event.provider, parsedPayload, {});

        if (result.error) {
          await db.webhookEvent.update({
            where: { id: event.id },
            data: { error: result.error.slice(0, 1000) },
          });
          stillFailing++;
          continue;
        }

        // Mark PROCESSED only after the dispatcher ran successfully.
        await db.webhookEvent.update({
          where: { id: event.id },
          data: { status: "PROCESSED", error: null, processedAt: new Date() },
        });

        succeeded++;
      } catch (err: any) {
        await db.webhookEvent.update({
          where: { id: event.id },
          data: { error: (err?.message ?? "RETRY_FAILED").slice(0, 1000) },
        });
        stillFailing++;
      }
    }

    await audit({
      action: "WEBHOOK_RETRY_CRON",
      category: "WEBHOOK",
      severity: "INFO",
      metadata: { total: failedEvents.length, succeeded, stillFailing },
    });

    return json({ data: { retried: failedEvents.length, succeeded, stillFailing } });
  } catch (err: any) {
    logger.error("cron.webhook-retry.fatal", { error: err?.message });
    return errorJson("Cron failed", 500, "CRON_FATAL");
  } finally {
    await releaseCronLock(lock);
  }
}
