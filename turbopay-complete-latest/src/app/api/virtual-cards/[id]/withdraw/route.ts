import { requireUser } from "@/lib/turbopay/auth";
import { enhancedCards } from "@/lib/turbocore/virtual-cards/enhanced";
import { notify } from "@/lib/turbocore/notifications";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { z } from "zod";

const schema = z.object({ amountKobo: z.number().int().min(5000) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const limited = await rateLimit(req, { key: "card-withdraw", limit: 10, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;
  const { id } = await params;
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  try {
    const result = await enhancedCards.withdrawFromCard(id, user.id, parsed.data.amountKobo);
    // Fire-and-forget in-app notification. Never throws, never blocks.
    notify.sendInApp({
      userId: user.id, type: "TRANSACTION", title: "Card Withdrawal",
      message: `₦${(parsed.data.amountKobo / 100).toLocaleString()} withdrawn from card to wallet`,
      actionUrl: "/cards", actionLabel: "View card",
    }).catch(() => null);
    return json({ data: result });
  }
  catch (e: any) { return errorJson(e.message, 400); }
}
