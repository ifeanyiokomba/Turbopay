import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

/**
 * ADMIN — audit logs + unresolved AML flags + platform metrics.
 * Requires ADMIN_VIEW_AUDIT permission (consistent with other admin routes).
 */
export async function GET(req: Request) {
  try {
    await requirePermission(Permissions.ADMIN_VIEW_AUDIT);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = (page - 1) * limit;

  const [logs, logTotal, flags, flagTotal, userCount, txCount, totalVolume, frozenWallets] = await Promise.all([
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { user: { select: { fullName: true, email: true } } },
    }),
    db.auditLog.count(),
    db.amlFlag.findMany({
      where: { resolved: false },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { user: { select: { fullName: true, email: true } } },
    }),
    db.amlFlag.count({ where: { resolved: false } }),
    db.user.count(),
    db.transaction.count({ where: { status: "SUCCESS" } }),
    db.transaction.aggregate({ where: { status: "SUCCESS" }, _sum: { amountKobo: true } }),
    db.wallet.count({ where: { status: "FROZEN" } }),
  ]);

  return json({
    data: {
      metrics: {
        userCount,
        txCount,
        totalVolumeKobo: totalVolume._sum.amountKobo ?? 0,
        frozenWallets,
        unresolvedFlags: flagTotal,
      },
      logs: {
        items: logs.map((l) => ({
          id: l.id,
          userId: l.userId,
          userName: l.user?.fullName ?? null,
          action: l.action,
          category: l.category,
          severity: l.severity,
          metadata: l.metadata ? JSON.parse(l.metadata) : null,
          createdAt: l.createdAt.toISOString(),
        })),
        total: logTotal,
        page,
        limit,
        hasMore: offset + logs.length < logTotal,
      },
      flags: {
        items: flags.map((f) => ({
          id: f.id,
          userId: f.userId,
          userName: f.user?.fullName ?? null,
          rule: f.rule,
          severity: f.severity,
          description: f.description,
          createdAt: f.createdAt.toISOString(),
        })),
        total: flagTotal,
        page,
        limit,
        hasMore: offset + flags.length < flagTotal,
      },
    },
  });
}
