import { enhancedKyc } from "@/lib/turbocore/kyc-enhanced";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET(req: Request) {
  try { await requirePermission(Permissions.KYC_APPROVE); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  return json({ data: await enhancedKyc.listPending(page) });
}
