/**
 * ADMIN — Alerting Dashboard
 * ============================
 *
 * GET    /api/admin/alerts          — list active alerts
 * POST   /api/admin/alerts/evaluate — trigger alert evaluation
 * PATCH  /api/admin/alerts/[id]     — acknowledge/resolve/dismiss alert
 * GET    /api/admin/alerts/summary  — alert summary counts
 */

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/turbocore/rbac";
import { Permissions } from "@/lib/turbocore/rbac";
import { alertingService } from "@/lib/turbocore/alerting";
import { logger } from "@/lib/turbocore/logger";

// GET /api/admin/alerts — list active alerts
export async function GET() {
  try {
    await requirePermission(Permissions.ADMIN_VIEW);
    const alerts = await alertingService.getActiveAlerts();
    return NextResponse.json({ data: alerts });
  } catch (error: any) {
    if (error?.code === "FORBIDDEN" || error?.status === 403) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/admin/alerts/evaluate — trigger alert evaluation
export async function POST() {
  try {
    const actor = await requirePermission(Permissions.ADMIN_RUN_RECONCILIATION);
    const result = await alertingService.evaluateAll();

    logger.info("admin.alerts.evaluate", {
      actorId: actor.id,
      conditionsChecked: result.conditionsChecked,
      alertsGenerated: result.alertsGenerated,
    });

    return NextResponse.json({ data: result });
  } catch (error: any) {
    if (error?.code === "FORBIDDEN" || error?.status === 403) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
