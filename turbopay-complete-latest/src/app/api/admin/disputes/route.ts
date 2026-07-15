import { disputes } from "@/lib/turbocore/disputes";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET(req: Request) {
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { searchParams } = new URL(req.url);
  const filters: any = {};
  if (searchParams.get("status")) filters.status = searchParams.get("status");
  if (searchParams.get("priority")) filters.priority = searchParams.get("priority");
  if (searchParams.get("type")) filters.type = searchParams.get("type");
  if (searchParams.get("assignedTo")) filters.assignedTo = searchParams.get("assignedTo");
  if (searchParams.get("q")) filters.q = searchParams.get("q");
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  return json({ data: await disputes.listAll(filters, page) });
}
