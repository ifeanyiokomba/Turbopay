import { requireUser } from "@/lib/turbopay/auth";
import { enhancedCards } from "@/lib/turbocore/virtual-cards/enhanced";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  try { return json({ data: await enhancedCards.getTransactions(id, user.id, page) }); }
  catch (e: any) { return errorJson(e.message, 404); }
}
