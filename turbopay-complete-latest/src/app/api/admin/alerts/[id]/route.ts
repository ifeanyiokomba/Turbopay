/**
 * ADMIN — Alert Actions
 * =======================
 *
 * PATCH /api/admin/alerts/[id] — acknowledge, resolve, or dismiss an alert
 *
 * Body: { action: "acknowledge" | "resolve" | "dismiss" }
 */

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/turbocore/rbac";
import { Permissions } from "@/lib/turbocore/rbac";
import { alertingService } from "@/lib/turbocore/alerting";
import { logger } from "@/lib/turbocore/logger";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requirePermission(Permissions.ADMIN_RUN_RECONCILIATION);
    const { id } = await params;
    const body = await request.json();

    if (!body.action || !["acknowledge", "resolve", "dismiss"].includes(body.action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be: acknowledge, resolve, or dismiss" },
        { status: 400 }
      );
    }

    switch (body.action) {
      case "acknowledge":
        await alertingService.acknowledge(id, actor.id);
        break;
      case "resolve":
        await alertingService.resolve(id, actor.id);
        break;
      case "dismiss":
        await alertingService.dismiss(id, actor.id);
        break;
    }

    logger.info("admin.alerts.action", {
      alertId: id,
      action: body.action,
      actorId: actor.id,
    });

    return NextResponse.json({ data: { success: true, action: body.action } });
  } catch (error: any) {
    if (error?.code === "FORBIDDEN" || error?.status === 403) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
