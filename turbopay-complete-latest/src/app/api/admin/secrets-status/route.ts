import { secretsStatus } from "@/lib/turbocore/config/secrets-status";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET() {
  try { await requirePermission(Permissions.ADMIN_VIEW_SECRETS_STATUS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await secretsStatus.getStatus() });
}
