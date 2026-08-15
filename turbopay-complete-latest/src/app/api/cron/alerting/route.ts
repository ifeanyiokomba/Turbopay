/**
 * CRON — Alerting Evaluation
 * ============================
 *
 * Runs every 5 minutes to evaluate alert conditions:
 *   - Provider health (degraded/down detection)
 *   - Stuck transactions
 *   - High failure rates
 *
 * Configured in k8s cronjobs (every 5 minutes).
 *
 * Protected by CRON_SECRET (Authorization: Bearer <secret>).
 */

import { NextResponse } from "next/server";
import { alertingService } from "@/lib/turbocore/alerting";
import { providerMetrics } from "@/lib/turbocore/providers/metrics";
import { acquireCronLock, releaseCronLock } from "@/lib/turbocore/cron-lock";
import { logger } from "@/lib/turbocore/logger";

function errorJson(message: string, status: number, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    { error: message, code: code ?? "CRON_ERROR", ...details },
    { status }
  );
}

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;
  const bearerToken = "Bearer " + expectedToken;
  if (expectedToken && authHeader !== bearerToken) {
    return errorJson("Unauthorized", 401, "UNAUTHORIZED");
  }

  const lock = await acquireCronLock("alerting", 120_000);
  if (!lock) {
    return errorJson("Another alerting run is already in progress", 429, "LOCK_HELD");
  }

  try {
    logger.info("cron.alerting.start", {});

    // Start metrics collection (no-op if already started)
    providerMetrics.start();

    // Run alert evaluation
    const result = await alertingService.evaluateAll();

    logger.info("cron.alerting.done", {
      conditionsChecked: result.conditionsChecked,
      alertsGenerated: result.alertsGenerated,
    });

    return NextResponse.json({
      data: {
        success: true,
        evaluatedAt: result.evaluatedAt.toISOString(),
        conditionsChecked: result.conditionsChecked,
        alertsGenerated: result.alertsGenerated,
        alerts: result.alerts,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("cron.alerting.fatal", { error: message });
    return errorJson("Alerting run failed", 500, "CRON_FATAL", { error: message });
  } finally {
    await releaseCronLock(lock);
  }
}
