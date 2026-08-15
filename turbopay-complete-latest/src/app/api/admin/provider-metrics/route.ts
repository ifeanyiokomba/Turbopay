/**
 * ADMIN — Provider Metrics Dashboard
 * =====================================
 *
 * GET /api/admin/provider-metrics            — global metrics summary
 * GET /api/admin/provider-metrics?provider=X — single provider metrics
 * GET /api/admin/provider-metrics?window=1h  — time window (5m|15m|1h|6h|24h|7d)
 */

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/turbocore/rbac";
import { Permissions } from "@/lib/turbocore/rbac";
import { providerMetrics } from "@/lib/turbocore/providers/metrics";
import type { TimeWindow } from "@/lib/turbocore/providers/metrics";

const VALID_WINDOWS: TimeWindow[] = ["5m", "15m", "1h", "6h", "24h", "7d"];

export async function GET(request: Request) {
  try {
    await requirePermission(Permissions.ADMIN_VIEW);

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const windowParam = searchParams.get("window") ?? "1h";
    const window = VALID_WINDOWS.includes(windowParam as TimeWindow)
      ? (windowParam as TimeWindow)
      : "1h";

    if (provider) {
      const summary = await providerMetrics.getSummary(provider, window);
      return NextResponse.json({ data: summary });
    }

    const globalSummary = await providerMetrics.getGlobalSummary(window);
    return NextResponse.json({ data: globalSummary });
  } catch (error: any) {
    if (error?.code === "FORBIDDEN" || error?.status === 403) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
