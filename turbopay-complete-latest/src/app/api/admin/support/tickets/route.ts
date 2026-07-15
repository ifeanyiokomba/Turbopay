import { support } from "@/lib/turbocore/support";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET(req: Request) {
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { searchParams } = new URL(req.url);
  const filters: Record<string, string | undefined> = {};
  filters.status = searchParams.get("status") ?? undefined;
  filters.category = searchParams.get("category") ?? undefined;
  filters.priority = searchParams.get("priority") ?? undefined;
  filters.assignedTo = searchParams.get("assignedTo") ?? undefined;
  filters.userId = searchParams.get("userId") ?? undefined;
  filters.q = searchParams.get("q") ?? undefined;
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  return json({ data: await support.listTickets(filters, page) });
}
