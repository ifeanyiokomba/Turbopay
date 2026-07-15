import { providerHealth } from "@/lib/turbocore/config/provider-health";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_VIEW_PROVIDER_HEALTH); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  return json({ data: await providerHealth.runCheck(id) });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_VIEW_PROVIDER_HEALTH); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  return json({ data: await providerHealth.getHistory(id) });
}
