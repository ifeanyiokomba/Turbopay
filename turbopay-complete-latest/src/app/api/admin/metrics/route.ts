import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { metrics } from "@/lib/turbocore/observability/metrics";
import { db } from "@/lib/db";

/**
 * GET /api/admin/metrics — Get all operational metrics.
 * Includes system metrics (DB, memory) + application metrics.
 */
export async function GET() {
  try {
    await requirePermission(Permissions.SYSTEM_VIEW_HEALTH);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  // System metrics.
  const memUsage = process.memoryUsage();
  const dbHealth = await db.$queryRaw`SELECT 1`.then(() => "ok").catch(() => "error");

  // Application metrics from the metrics collector.
  const appMetrics = metrics.snapshot();

  // Business metrics (quick aggregates).
  const [totalUsers, activeUsers, totalTransactions, pendingSettlements, openDisputes] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { status: "ACTIVE" } }),
    db.transaction.count(),
    db.settlement.count({ where: { status: "PENDING" } }),
    db.dispute.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
  ]);

  return json({
    data: {
      system: {
        database: dbHealth,
        memory: {
          rss: Math.round(memUsage.rss / 1024 / 1024),
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        },
        uptime: Math.round(process.uptime()),
      },
      business: {
        totalUsers,
        activeUsers,
        totalTransactions,
        pendingSettlements,
        openDisputes,
      },
      application: appMetrics,
    },
  });
}
