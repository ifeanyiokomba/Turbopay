import { fees } from "@/lib/turbocore/fees";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

/** DELETE /api/admin/fees/[id] — deactivate a fee config (soft delete). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FEES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  try {
    await fees.delete(id);
  } catch (e: any) {
    return errorJson(e.message ?? "Could not delete fee", 500);
  }
  return json({ data: { id, deactivated: true } });
}
