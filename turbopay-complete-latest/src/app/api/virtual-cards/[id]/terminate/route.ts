import { requireUser } from "@/lib/turbopay/auth";
import { enhancedCards } from "@/lib/turbocore/virtual-cards/enhanced";
import { notify } from "@/lib/turbocore/notifications";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const limited = await rateLimit(_req, { key: "card-terminate", limit: 3, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;
  const { id } = await params;
  try {
    const result = await enhancedCards.terminateCard(id, user.id);
    notify.sendInApp({
      userId: user.id, type: "SECURITY", title: "Card Terminated",
      message: result.refundedKobo > 0
        ? `Your virtual card has been terminated. ₦${(result.refundedKobo / 100).toLocaleString()} was refunded to your wallet.`
        : `Your virtual card has been terminated and can no longer be used for transactions.`,
      priority: "HIGH", actionUrl: "/cards", actionLabel: "View cards",
    }).catch(() => null);
    return json({ data: result });
  }
  catch (e: any) { return errorJson(e.message, 400); }
}
