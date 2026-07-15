import { kycLimits } from "@/lib/turbocore/config/kyc-limits";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  try { await requirePermission(Permissions.ADMIN_MANAGE_KYC_LIMITS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await kycLimits.list() });
}

const schema = z.object({
  tier: z.number().int().min(1).max(3), product: z.string().default("turbopay"),
  singleTxMinor: z.number().int().min(0), dailyTxMinor: z.number().int().min(0),
  balanceMinor: z.number().int().min(0), label: z.string().min(2),
});

export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_KYC_LIMITS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  return json({ data: await kycLimits.set(parsed.data.tier, parsed.data.product, parsed.data, user ? { id: user.id, name: user.fullName } : undefined) });
}
