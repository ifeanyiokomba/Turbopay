import { enhancedKyc } from "@/lib/turbocore/kyc-enhanced";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

const schema = z.object({ decision: z.enum(["APPROVED", "REJECTED", "RESUBMIT"]), notes: z.string().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission(Permissions.KYC_APPROVE); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  const { id } = await params;
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson("Invalid", 422, "VALIDATION");
  return json({ data: await enhancedKyc.reviewAddress(id, { ...parsed.data, reviewerId: user!.id, reviewerName: user!.fullName }) });
}
