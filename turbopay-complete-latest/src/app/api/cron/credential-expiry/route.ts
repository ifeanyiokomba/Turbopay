import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { verifyCronSecret } from "@/lib/turbocore/cron-auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/turbocore/logger";
import { json, errorJson } from "@/lib/turbopay/api";
import { randomUUID } from "node:crypto";

/**
 * CRON — Credential Expiry Reminders
 * ====================================
 *
 * Checks all enabled ProviderConfig rows for credentials approaching
 * expiry (within 30 days) or already expired. Logs warnings for
 * admin attention. Runs weekly.
 *
 * Auth: x-cron-secret header must match CRON_SECRET.
 * Schedule: weekly on Monday at 06:00 (Vercel: "0 6 * * 1")
 */

const EFFECTIVE_SECRET = process.env.CRON_SECRET ?? null;
const EXPIRY_WARNING_DAYS = 30;

export async function GET(req: Request) {
  const provided = req.headers.get("x-cron-secret");
  if (!EFFECTIVE_SECRET) return errorJson("CRON_SECRET not configured", 500, "CRON_NOT_CONFIGURED");
  if (!provided || !verifyCronSecret(provided, EFFECTIVE_SECRET)) return errorJson("Unauthorized", 401, "CRON_UNAUTHORIZED");

  const requestId = randomUUID();
  const lock = await acquireCronLock("credential-expiry", 120_000);
  if (!lock) return json({ data: { skipped: true, reason: "already_running" } });

  try {
    const now = new Date();
    const warningThreshold = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);

    // Find configs with expiry dates approaching or past
    const expiringConfigs = await db.providerConfig.findMany({
      where: {
        enabled: true,
        expiresAt: { not: null, lte: warningThreshold },
      },
      select: {
        id: true,
        providerName: true,
        contract: true,
        expiresAt: true,
      },
    });

    const expired: typeof expiringConfigs = [];
    const expiringSoon: typeof expiringConfigs = [];

    for (const config of expiringConfigs) {
      if (!config.expiresAt) continue;
      if (config.expiresAt < now) {
        expired.push(config);
      } else {
        expiringSoon.push(config);
      }
    }

    // Log each as a warning for alerting
    for (const config of expired) {
      logger.warn("credential.expired", {
        providerName: config.providerName,
        contract: config.contract,
        expiresAt: config.expiresAt!.toISOString(),
        requestId,
      });
    }
    for (const config of expiringSoon) {
      logger.warn("credential.expiring_soon", {
        providerName: config.providerName,
        contract: config.contract,
        expiresAt: config.expiresAt!.toISOString(),
        daysUntilExpiry: Math.ceil((config.expiresAt!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
        requestId,
      });
    }

    return json({
      data: {
        expired: expired.length,
        expiringSoon: expiringSoon.length,
        totalChecked: expiringConfigs.length,
        expiredProviders: expired.map((c) => c.providerName),
        expiringProviders: expiringSoon.map((c) => c.providerName),
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("cron.credential-expiry.fatal", { error: message, requestId });
    return errorJson("Credential expiry check failed", 500, "CRON_FATAL", { error: message });
  } finally {
    await releaseCronLock(lock);
  }
}
