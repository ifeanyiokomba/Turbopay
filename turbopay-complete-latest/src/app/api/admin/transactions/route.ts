import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

/**
 * ADMIN — list ALL transactions across all users with rich filters + aggregate
 * stats. Uses standard Prisma findMany / aggregate / groupBy (no PostgreSQL-
 * specific $queryRaw / DATE_TRUNC — works on SQLite dev environment).
 *
 * Filters: q (reference/description/counterparty), type, status, direction,
 * provider, amountMin/amountMax (kobo), from/to (ISO date).
 */
export async function GET(req: Request) {
  try {
    await requirePermission(Permissions.TX_VIEW_ALL);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const type = searchParams.get("type"); // comma list
  const status = searchParams.get("status");
  const direction = searchParams.get("direction");
  const provider = searchParams.get("provider");
  const amountMin = searchParams.get("amountMin");
  const amountMax = searchParams.get("amountMax");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = (page - 1) * limit;

  const where: any = {};
  if (type && type !== "ALL") {
    where.type = { in: type.split(",").map((t) => t.trim()).filter(Boolean) };
  }
  if (status && status !== "ALL") where.status = status;
  if (direction && direction !== "ALL") where.direction = direction;
  if (provider && provider !== "ALL") where.provider = provider;
  if (amountMin || amountMax) {
    where.amountKobo = {};
    if (amountMin) where.amountKobo.gte = parseInt(amountMin, 10);
    if (amountMax) where.amountKobo.lte = parseInt(amountMax, 10);
  }
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }
  if (q) {
    where.OR = [
      { reference: { contains: q } },
      { description: { contains: q } },
      { counterpartyName: { contains: q } },
      { counterpartyAccount: { contains: q } },
    ];
  }

  const [total, items, aggVolume, aggFees, aggCount, byType, byProvider] = await Promise.all([
    db.transaction.count({ where }),
    db.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { user: { select: { id: true, fullName: true, email: true } } },
    }),
    db.transaction.aggregate({ where, _sum: { amountKobo: true } }),
    db.transaction.aggregate({ where, _sum: { feeKobo: true } }),
    db.transaction.count({ where }),
    db.transaction.groupBy({
      by: ["type"],
      where,
      _sum: { amountKobo: true },
      _count: { _all: true },
    }),
    db.transaction.groupBy({
      by: ["provider"],
      where,
      _sum: { amountKobo: true },
      _count: { _all: true },
    }),
  ]);

  return json({
    data: {
      items: items.map((t) => ({
        id: t.id,
        reference: t.reference,
        userId: t.userId,
        userName: t.user?.fullName ?? null,
        userEmail: t.user?.email ?? null,
        type: t.type,
        direction: t.direction,
        amountKobo: t.amountKobo,
        feeKobo: t.feeKobo,
        status: t.status,
        counterpartyName: t.counterpartyName,
        counterpartyAccount: t.counterpartyAccount,
        counterpartyBank: t.counterpartyBank,
        description: t.description,
        provider: t.provider,
        providerRef: t.providerRef,
        reversalOfId: t.reversalOfId,
        createdAt: t.createdAt.toISOString(),
      })),
      page,
      limit,
      total,
      hasMore: offset + items.length < total,
      stats: {
        totalVolumeKobo: aggVolume._sum.amountKobo ?? 0,
        totalFeesKobo: aggFees._sum.feeKobo ?? 0,
        count: aggCount,
        byType: byType.map((b) => ({
          type: b.type,
          volumeKobo: b._sum.amountKobo ?? 0,
          count: b._count._all,
        })),
        byProvider: byProvider.map((b) => ({
          provider: b.provider ?? "unknown",
          volumeKobo: b._sum.amountKobo ?? 0,
          count: b._count._all,
        })),
      },
    },
  });
}
