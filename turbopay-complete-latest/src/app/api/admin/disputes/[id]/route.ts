import { disputes } from "@/lib/turbocore/disputes";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  const dispute = await disputes.getDispute(id);
  if (!dispute) return errorJson("Dispute not found", 404);
  return json({ data: dispute });
}

const schema = z.object({
  status: z.string().optional(), priority: z.string().optional(), assignedTo: z.string().optional(),
  resolution: z.string().optional(), resolutionNotes: z.string().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.AML_RESOLVE); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  const { id } = await params;
  let body; try { body = await req.json(); } catch { body = {}; }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson("Invalid", 422, "VALIDATION");
  return json({ data: await disputes.update(id, parsed.data, user ? { id: user.id, name: user.fullName } : undefined) });
}
