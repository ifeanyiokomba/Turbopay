import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { selfAuditEngine } from "@/lib/turbocore/audit/self-audit";

/**
 * GET /api/admin/self-audit — Run a full self-audit and return findings.
 * POST /api/admin/self-audit — Run a specific audit check.
 */
export async function GET() {
  try {
    await requirePermission(Permissions.ADMIN_VIEW);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const report = await selfAuditEngine.runFullAudit();
  return json({ data: report });
}
