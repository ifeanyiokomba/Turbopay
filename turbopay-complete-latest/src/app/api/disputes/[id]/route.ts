import { requireUser } from "@/lib/turbopay/auth";
import { disputes } from "@/lib/turbocore/disputes";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  const dispute = await disputes.getDispute(id);
  if (!dispute) return errorJson("Dispute not found", 404);
  if (dispute.userId !== user.id && user.role === "USER") return errorJson("Access denied", 403);
  return json({ data: dispute });
}
