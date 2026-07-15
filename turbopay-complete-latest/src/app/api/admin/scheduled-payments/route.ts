import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET(req: Request) {
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  const where = status ? { status } : {};
  const [items, total] = await Promise.all([
    db.scheduledPayment.findMany({ where, orderBy: { nextExecutionAt: "asc" }, take: 50, skip: (page - 1) * 50, include: { user: { select: { fullName: true, email: true } } } }),
    db.scheduledPayment.count({ where }),
  ]);
  return json({ data: { items, total, page, limit: 50 } });
}
