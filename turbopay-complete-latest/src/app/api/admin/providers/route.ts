import { providerConfig } from "@/lib/turbocore/config/provider-config";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  try { await requirePermission(Permissions.ADMIN_MANAGE_PROVIDER_CONFIG); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await providerConfig.list() });
}

const schema = z.object({
  contract: z.string().min(2), providerName: z.string().min(2), displayName: z.string().min(2),
  mode: z.enum(["mock", "sandbox", "production"]).default("mock"),
  credentials: z.record(z.string(), z.string()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().default(100), enabled: z.boolean().default(true),
  healthCheckUrl: z.string().url().nullish(), healthCheckIntervalSec: z.number().int().default(300),
});

export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_PROVIDER_CONFIG); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  try { return json({ data: await providerConfig.create(parsed.data, user ? { id: user.id, name: user.fullName } : undefined) }, 201); }
  catch (e: any) { return errorJson(e.message, 400, "VALIDATION_ERROR"); }
}
