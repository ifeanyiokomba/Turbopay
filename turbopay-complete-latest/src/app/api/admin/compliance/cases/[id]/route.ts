import { complianceCases } from "@/lib/turbocore/compliance/cases";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_COMPLIANCE_CASES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  const result = await complianceCases.getCase(id);
  return result ? json({ data: result }) : errorJson("Case not found", 404);
}

const schema = z.object({ status: z.string().optional(), notes: z.string().optional(), assignedTo: z.string().optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_COMPLIANCE_CASES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  const { id } = await params;
  let body; try { body = await req.json(); } catch { body = {}; }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  return json({ data: await complianceCases.updateCase(id, parsed.data, user ? { id: user.id, name: user.fullName } : undefined) });
}
