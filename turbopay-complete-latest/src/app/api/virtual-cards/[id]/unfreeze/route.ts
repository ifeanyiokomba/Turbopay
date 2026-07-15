import { requireUser } from "@/lib/turbopay/auth";
import { enhancedCards } from "@/lib/turbocore/virtual-cards/enhanced";
import { notify } from "@/lib/turbocore/notifications";
import { errorJson, json } from "@/lib/turbopay/api";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  try {
    await enhancedCards.unfreezeCard(id, user.id);
    // Fire-and-forget in-app notification. Never throws, never blocks.
    notify.sendInApp({
      userId: user.id, type: "SECURITY", title: "Card Unfrozen",
      message: `Your virtual card is now active and ready to use.`,
      actionUrl: "/cards", actionLabel: "View card",
    }).catch(() => null);
    return json({ data: { ok: true } });
  }
  catch (e: any) { return errorJson(e.message, 400); }
}
