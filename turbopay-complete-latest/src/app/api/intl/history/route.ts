import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";

/**
 * GET /api/intl/history — list international transfer history for the user.
 */
export async function GET(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
  const cursor = searchParams.get("cursor");

  const where: Record<string, unknown> = { userId: user.id };
  if (status) where.status = status;

  const transfers = await db.transaction.findMany({
    where: { ...where, provider: "intl-transfer" },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = transfers.length > limit;
  const items = hasMore ? transfers.slice(0, limit) : transfers;

  return json({
    data: items,
    nextCursor: hasMore ? items[items.length - 1]?.id : null,
  });
}
