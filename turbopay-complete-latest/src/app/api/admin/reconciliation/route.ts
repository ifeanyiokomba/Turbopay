import { reconciliation } from "@/lib/turbocore/reconciliation";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

/** GET /api/admin/reconciliation — list past runs. */
export async function GET() {
  try { await requirePermission(Permissions.ADMIN_RUN_RECONCILIATION); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const runs = await reconciliation.listRuns();
  return json({ data: runs });
}

/** POST /api/admin/reconciliation — trigger a manual reconciliation run. */
export async function POST() {
  try { await requirePermission(Permissions.ADMIN_RUN_RECONCILIATION); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const result = await reconciliation.runAll("MANUAL");
  return json({ data: result });
}
