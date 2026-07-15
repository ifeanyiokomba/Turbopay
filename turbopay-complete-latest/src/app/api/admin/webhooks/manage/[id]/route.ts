import { webhookManagement } from "@/lib/turbocore/config/webhook-management";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

const schema = z.object({
  url: z.string().url().optional(), secret: z.string().optional(), enabled: z.boolean().optional(),
  maxRetries: z.number().int().optional(), retryDelaySec: z.number().int().optional(),
  action: z.enum(["update", "enable", "disable", "verify"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_WEBHOOKS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  const { id } = await params;
  let body; try { body = await req.json(); } catch { body = {}; }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  const actor = user ? { id: user.id, name: user.fullName } : undefined;
  const action = parsed.data.action ?? "update";
  if (action === "enable") return json({ data: await webhookManagement.enable(id, actor) });
  if (action === "disable") return json({ data: await webhookManagement.disable(id, actor) });
  if (action === "verify") return json({ data: await webhookManagement.markVerified(id, actor) });
  return json({ data: await webhookManagement.update(id, parsed.data, actor) });
}
