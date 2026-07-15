import { requireAdmin } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";

/**
 * GET /api/admin/investments — List all investments (admin view).
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
    db.userInvestment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        investmentProduct: { select: { name: true, type: true, expectedReturnBps: true } },
      },
    }),
    db.userInvestment.count({ where }),
  ]);

  return json({ data: { items, total, page, limit, totalPages: Math.ceil(total / limit) } });
}
