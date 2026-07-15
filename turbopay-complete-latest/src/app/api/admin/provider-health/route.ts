import { providerHealth } from "@/lib/turbocore/config/provider-health";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET() {
  try { await requirePermission(Permissions.ADMIN_VIEW_PROVIDER_HEALTH); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await providerHealth.listSummaries() });
}
