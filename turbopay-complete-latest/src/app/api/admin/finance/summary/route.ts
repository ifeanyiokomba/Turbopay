import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { cacheAside } from "@/lib/turbocore/cache";

/**
 * ADMIN — financial summary for a given period.
 * Period: today | 7d | 30d | 90d | ytd (default 30d).
 *
 * Returns: totalVolumeKobo, totalFeesKobo, counts (total, success, failed),
 * byType (volume + count), byProvider, dailySeries (volume + count by day).
 *
 * Performance: the daily-series query is capped at 10,000 rows (take limit)
 * and the entire response is cached for 60 seconds (cacheAside) so repeated
 * admin dashboard loads don't re-scan the transactions table.
 */
export async function GET(req: Request) {
  try {
    await requirePermission(Permissions.ADMIN_VIEW);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") ?? "30d";

  // Cache the summary for 60 seconds per period — prevents re-scanning the
  // transactions table on every admin dashboard refresh.
  const cacheKey = `admin:finance:summary:${period}`;
  const data = await cacheAside(cacheKey, 60_000, async () => {
    const now = new Date();
    let from: Date;
    switch (period) {
      case "today":
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "7d":
        from = new Date(now.getTime() - 7 * 86400_000);
        break;
      case "90d":
        from = new Date(now.getTime() - 90 * 86400_000);
        break;
      case "ytd":
        from = new Date(now.getFullYear(), 0, 1);
        break;
      case "30d":
      default:
        from = new Date(now.getTime() - 30 * 86400_000);
        break;
    }

    const where = { createdAt: { gte: from } };

    const [
      aggVolume,
      aggFees,
      totalCount,
      successCount,
      failedCount,
      byType,
      byProvider,
      byStatus,
      dailyTxs,
    ] = await Promise.all([
      db.transaction.aggregate({ where, _sum: { amountKobo: true } }),
      db.transaction.aggregate({ where, _sum: { feeKobo: true } }),
      db.transaction.count({ where }),
      db.transaction.count({ where: { ...where, status: "SUCCESS" } }),
      db.transaction.count({ where: { ...where, status: "FAILED" } }),
      db.transaction.groupBy({
        by: ["type"],
        where,
        _sum: { amountKobo: true, feeKobo: true },
        _count: { _all: true },
      }),
      db.transaction.groupBy({
        by: ["provider"],
        where,
        _sum: { amountKobo: true },
        _count: { _all: true },
      }),
      db.transaction.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
      // Cap at 10,000 rows to prevent OOM on high-traffic deployments.
      // For periods > 90d with > 10k txs, the daily series is approximate.
      db.transaction.findMany({
        where,
        select: { amountKobo: true, createdAt: true, status: true },
        orderBy: { createdAt: "asc" },
        take: 10_000,
      }),
    ]);

    // Group daily series in JS (SQLite has no DATE_TRUNC).
    const dayMap = new Map<string, { volumeKobo: number; count: number; successCount: number }>();
    for (const t of dailyTxs) {
      const day = t.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD
      const entry = dayMap.get(day) ?? { volumeKobo: 0, count: 0, successCount: 0 };
      entry.volumeKobo += t.amountKobo;
      entry.count += 1;
      if (t.status === "SUCCESS") entry.successCount += 1;
      dayMap.set(day, entry);
    }
    const dailySeries = Array.from(dayMap.entries())
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => (a.day < b.day ? -1 : 1));

    return {
      period,
      from: from.toISOString(),
      to: now.toISOString(),
      totalVolumeKobo: aggVolume._sum.amountKobo ?? 0,
      totalFeesKobo: aggFees._sum.feeKobo ?? 0,
      counts: {
        total: totalCount,
        success: successCount,
        failed: failedCount,
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      },
      byType: byType.map((b) => ({
        type: b.type,
        volumeKobo: b._sum.amountKobo ?? 0,
        feesKobo: b._sum.feeKobo ?? 0,
        count: b._count._all,
      })),
      byProvider: byProvider.map((b) => ({
        provider: b.provider ?? "unknown",
        volumeKobo: b._sum.amountKobo ?? 0,
        count: b._count._all,
      })),
      dailySeries,
    };
  });

  return json({ data });
}
