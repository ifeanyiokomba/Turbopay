import { requireUser } from "@/lib/turbopay/auth";
import { scheduledPayments } from "@/lib/turbocore/scheduled-payments";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const limited = await rateLimit(req, { key: "scheduled-payment", limit: 10, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  if (action === "pause") return json({ data: await scheduledPayments.pause(id, user.id) });
  if (action === "resume") return json({ data: await scheduledPayments.resume(id, user.id) });
  return json({ data: await scheduledPayments.cancel(id, user.id) });
}
