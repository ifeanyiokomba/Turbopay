import { requireAdmin } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";

/**
 * GET /api/admin/audit/reports — Generate audit reports for compliance.
 *
 * Query params:
 *   - from: ISO date string (default: 30 days ago)
 *   - to: ISO date string (default: now)
 *   - category: filter by category (AUTH, WALLET, BILL, AML, etc.)
 *   - severity: filter by severity (INFO, WARN, ERROR, CRITICAL)
 *   - userId: filter by specific user
 *   - format: "summary" (default) or "detailed"
 */
export async function GET(req: Request) {
  let admin;
  try { admin = await requireAdmin(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { searchParams } = new URL(req.url);
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : new Date();
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const category = searchParams.get("category") ?? undefined;
  const severity = searchParams.get("severity") ?? undefined;
  const userId = searchParams.get("userId") ?? undefined;
  const format = searchParams.get("format") ?? "summary";

  const where: any = { createdAt: { gte: from, lte: to } };
  if (category) where.category = category;
  if (severity) where.severity = severity;
  if (userId) where.userId = userId;

  try {
    // Get audit logs
    const logs = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: format === "detailed" ? 1000 : 100,
      select: {
        id: true,
        userId: true,
        action: true,
        category: true,
        severity: true,
        ip: true,
        metadata: true,
        createdAt: true,
      },
    });

    // Aggregate by category
    const byCategory: Record<string, number> = {};
    for (const log of logs) {
      byCategory[log.category] = (byCategory[log.category] ?? 0) + 1;
    }

    // Aggregate by severity
    const bySeverity: Record<string, number> = {};
    for (const log of logs) {
      bySeverity[log.severity] = (bySeverity[log.severity] ?? 0) + 1;
    }

    // Aggregate by action (top 20)
    const actionCounts: Record<string, number> = {};
    for (const log of logs) {
      actionCounts[log.action] = (actionCounts[log.action] ?? 0) + 1;
    }
    const topActions = Object.entries(actionCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([action, count]) => ({ action, count }));

    // Unique users
    const uniqueUsers = new Set(logs.filter((l) => l.userId).map((l) => l.userId));

    // Error rate
    const errorCount = logs.filter((l) => l.severity === "ERROR" || l.severity === "CRITICAL").length;
    const errorRate = logs.length > 0 ? Math.round((errorCount / logs.length) * 100) : 0;

    return json({
      data: {
        summary: {
          totalEvents: logs.length,
          uniqueUsers: uniqueUsers.size,
          errorRate,
          dateRange: { from: from.toISOString(), to: to.toISOString() },
        },
        byCategory,
        bySeverity,
        topActions,
        logs: format === "detailed" ? logs : undefined,
      },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (e: any) {
    return errorJson(e.message ?? "Audit report failed", 500);
  }
}
