import { getRecentConfigChanges, getConfigHistory } from "@/lib/turbocore/config/versioning";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET(req: Request) {
  try { await requirePermission(Permissions.ADMIN_VIEW_CONFIG_HISTORY); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entityType"); const entityId = searchParams.get("entityId");
  if (entityType && entityId) return json({ data: await getConfigHistory(entityType, entityId) });
  return json({ data: await getRecentConfigChanges() });
}
