import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { removeEntry, toggleEntry } from "@/lib/turbocore/compliance/screening";

/**
 * PATCH /api/admin/sanctions/[id] — Toggle active status.
 * DELETE /api/admin/sanctions/[id] — Remove entry.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_VIEW_AUDIT); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { active } = body as { active?: boolean };
  if (active === undefined) return errorJson("active field is required", 422, "VALIDATION");

  const entry = await toggleEntry(id, active);
  return json({ data: entry });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_VIEW_AUDIT); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { id } = await params;
  await removeEntry(id);
  return json({ data: { ok: true } });
}
