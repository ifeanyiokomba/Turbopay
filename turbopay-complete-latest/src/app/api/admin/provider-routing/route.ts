import { providerRouting } from "@/lib/turbocore/config/provider-routing";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_PROVIDER_ROUTING); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { searchParams } = new URL(req.url);
  const contract = searchParams.get("contract");
  if (!contract) return errorJson("contract query param required", 400);
  return json({ data: await providerRouting.getRouteConfig(contract) });
}

const schema = z.object({
  contract: z.string().min(2), tier: z.enum(["PRIMARY", "SECONDARY", "FALLBACK", "CANARY"]),
  providerConfigId: z.string().min(1), rules: z.record(z.string(), z.unknown()).optional(),
  failoverThreshold: z.number().int().min(1).max(10).default(3), enabled: z.boolean().default(true),
  canaryPercent: z.number().int().min(0).max(100).default(0),
});

export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_PROVIDER_ROUTING); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  return json({ data: await providerRouting.setRoute(parsed.data.contract, parsed.data.tier, parsed.data.providerConfigId, parsed.data, user ? { id: user.id, name: user.fullName } : undefined) });
}
