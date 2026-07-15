import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET(req: Request) {
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  const limit = 50;
  const [items, total] = await Promise.all([
    db.statementRequest.findMany({ orderBy: { createdAt: "desc" }, take: limit, skip: (page - 1) * limit, include: { user: { select: { fullName: true, email: true } } } }),
    db.statementRequest.count(),
  ]);
  return json({ data: { items, total, page, limit } });
}
