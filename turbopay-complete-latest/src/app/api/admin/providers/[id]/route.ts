import { providerConfig } from "@/lib/turbocore/config/provider-config";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

const schema = z.object({
  displayName: z.string().min(2).optional(), mode: z.enum(["mock", "sandbox", "production"]).optional(),
  credentials: z.record(z.string(), z.string()).optional(), config: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().optional(), enabled: z.boolean().optional(),
  healthCheckUrl: z.string().url().nullish(), healthCheckIntervalSec: z.number().int().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_PROVIDER_CONFIG); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  const { id } = await params;
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  try { return json({ data: await providerConfig.update(id, parsed.data, user ? { id: user.id, name: user.fullName } : undefined) }); }
  catch (e: any) { return errorJson(e.message, 404, "NOT_FOUND"); }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_PROVIDER_CONFIG); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  const { id } = await params;
  try { await providerConfig.delete(id, user ? { id: user.id, name: user.fullName } : undefined); return json({ data: { ok: true } }); }
  catch (e: any) { return errorJson(e.message, 404, "NOT_FOUND"); }
}
