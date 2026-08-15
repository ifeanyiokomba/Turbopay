/**
 * ADMIN — Alert Summary
 * ======================
 *
 * GET /api/admin/alerts/summary — alert summary counts
 */

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/turbocore/rbac";
import { Permissions } from "@/lib/turbocore/rbac";
import { alertingService } from "@/lib/turbocore/alerting";

export async function GET() {
  try {
    await requirePermission(Permissions.ADMIN_VIEW);
    const summary = await alertingService.getSummary();
    return NextResponse.json({ data: summary });
  } catch (error: any) {
    if (error?.code === "FORBIDDEN" || error?.status === 403) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
