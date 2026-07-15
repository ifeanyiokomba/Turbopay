import { requireAdmin } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";

/**
 * GET /api/admin/virtual-cards — List all virtual cards (admin view).
 * Supports pagination and filtering by status.
 */
export async function GET(req: Request) {
  let admin;
  try { admin = await requireAdmin(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
  const status = searchParams.get("status") ?? undefined;

  const where: any = {};
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    db.virtualCard.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
      select: {
        id: true,
        userId: true,
        provider: true,
        last4: true,
        brand: true,
        type: true,
        status: true,
        balanceKobo: true,
        currency: true,
        spendingLimitKobo: true,
        createdAt: true,
      },
    }),
    db.virtualCard.count({ where }),
  ]);

  return json({ data: { items, total, page, limit, totalPages: Math.ceil(total / limit) } });
}
