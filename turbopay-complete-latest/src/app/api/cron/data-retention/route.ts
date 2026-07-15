import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/turbocore/logger";
import { json, errorJson } from "@/lib/turbopay/api";

/**
 * CRON — Data Retention & Account Purge
 * =======================================
 *
 * Purges soft-deleted user accounts after 30 days (GDPR/NDPR compliance).
 * Deletes old audit logs older than 90 days, notification logs older than 60 days,
 * and provider health check records older than 30 days.
 *
 * Auth: x-cron-secret header must match CRON_SECRET.
 * Schedule: daily at 04:00 (Vercel: "0 4 * * *")
 */
const EFFECTIVE_SECRET = process.env.CRON_SECRET ?? null;

export async function GET(req: Request) {
  const provided = req.headers.get("x-cron-secret");
  if (!EFFECTIVE_SECRET) return errorJson("CRON_SECRET not configured", 500, "CRON_NOT_CONFIGURED");
  if (!provided || !verifyCronSecret(provided, EFFECTIVE_SECRET)) return errorJson("Unauthorized", 401, "CRON_UNAUTHORIZED");

  const lock = await acquireCronLock("data-retention", 120_000);
  if (!lock) return json({ ok: false, reason: "already running" }, 409);

  try {
    const now = new Date();

    const purgeThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const deletedUsers = await db.user.deleteMany({
      where: { status: "DELETED", updatedAt: { lt: purgeThreshold } },
    });

    const auditThreshold = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const deletedAudit = await db.auditLog.deleteMany({
      where: { createdAt: { lt: auditThreshold } },
    });

    const notifThreshold = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const deletedNotifs = await db.notificationLog.deleteMany({
      where: { createdAt: { lt: notifThreshold } },
    });

    const healthCheckThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const deletedHealthChecks = await db.providerHealthCheck.deleteMany({
      where: { checkedAt: { lt: healthCheckThreshold } },
    });

    logger.info("cron.data-retention.done", {
      deletedUsers: deletedUsers.count,
      deletedAuditLogs: deletedAudit.count,
      deletedNotifications: deletedNotifs.count,
      deletedHealthChecks: deletedHealthChecks.count,
    });

    return json({
      data: {
        deletedUsers: deletedUsers.count,
        deletedAuditLogs: deletedAudit.count,
        deletedNotifications: deletedNotifs.count,
        deletedHealthChecks: deletedHealthChecks.count,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("cron.data-retention.fatal", { error: message });
    return errorJson(message, 500);
  } finally {
    await releaseCronLock(lock);
  }
}
