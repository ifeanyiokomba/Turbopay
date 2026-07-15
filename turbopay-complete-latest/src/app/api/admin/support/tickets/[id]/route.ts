import { support } from "@/lib/turbocore/support";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  const ticket = await support.getTicket(id);
  if (!ticket) return errorJson("Ticket not found", 404);
  return json({ data: ticket });
}

const schema = z.object({
  status: z.string().optional(), priority: z.string().optional(),
  assignedTo: z.string().optional(), subcategory: z.string().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  const { id } = await params;
  let body; try { body = await req.json(); } catch { body = {}; }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson("Invalid", 422, "VALIDATION");
  const updated = await support.updateTicket(id, parsed.data, user ? { id: user.id, name: user.fullName } : undefined);
  return json({ data: updated });
}
