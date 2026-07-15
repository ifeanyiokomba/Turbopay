import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { providerScoringEngine } from "@/lib/turbocore/providers/scoring";
import { providerHealthMonitor } from "@/lib/turbocore/providers/health-monitor";

/**
 * GET /api/admin/provider-scores — Get provider scores for all providers.
 * POST /api/admin/provider-scores — Trigger a health check cycle.
 */
export async function GET() {
  try {
    await requirePermission(Permissions.ADMIN_VIEW_PROVIDER_HEALTH);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const scores = await providerScoringEngine.scoreAll();
  const dashboard = await providerHealthMonitor.getDashboard();

  return json({ data: { scores, dashboard } });
}

export async function POST() {
  try {
    await requirePermission(Permissions.ADMIN_VIEW_PROVIDER_HEALTH);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  // Trigger a health check cycle.
  const results = await providerHealthMonitor.runAllChecks();
  return json({ data: { checked: results.length, results } });
}
