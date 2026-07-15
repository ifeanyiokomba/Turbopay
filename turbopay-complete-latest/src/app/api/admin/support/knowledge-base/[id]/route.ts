import { knowledgeBase } from "@/lib/turbocore/knowledge-base";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(3).optional(), content: z.string().min(10).optional(),
  category: z.string().optional(), status: z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED"]).optional(), tags: z.string().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FLAGS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson("Invalid", 422, "VALIDATION");
  return json({ data: await knowledgeBase.update(id, parsed.data) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FLAGS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  await knowledgeBase.delete(id);
  return json({ data: { ok: true } });
}
