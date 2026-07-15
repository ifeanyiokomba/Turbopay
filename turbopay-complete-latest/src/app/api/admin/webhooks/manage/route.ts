import { webhookManagement } from "@/lib/turbocore/config/webhook-management";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  try { await requirePermission(Permissions.ADMIN_MANAGE_WEBHOOKS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await webhookManagement.list() });
}

const schema = z.object({
  providerName: z.string().min(2), contract: z.string().min(2), url: z.string().url(),
  secret: z.string().optional(), enabled: z.boolean().default(true),
  maxRetries: z.number().int().default(5), retryDelaySec: z.number().int().default(60),
});

export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_WEBHOOKS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  return json({ data: await webhookManagement.register(parsed.data, user ? { id: user.id, name: user.fullName } : undefined) }, 201);
}
