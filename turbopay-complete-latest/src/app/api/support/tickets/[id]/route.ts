import { requireUser } from "@/lib/turbopay/auth";
import { support } from "@/lib/turbocore/support";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  const ticket = await support.getTicket(id);
  if (!ticket) return errorJson("Ticket not found", 404);
  // User can only see their own tickets; admin can see all.
  if (ticket.userId !== user.id && user.role === "USER") return errorJson("Access denied", 403);
  return json({ data: ticket });
}
