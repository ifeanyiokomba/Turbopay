import { requireUser } from "@/lib/turbopay/auth";
import { enhancedCards } from "@/lib/turbocore/virtual-cards/enhanced";
import { notify } from "@/lib/turbocore/notifications";
import { errorJson, json } from "@/lib/turbopay/api";

/**
 * POST /api/virtual-cards/[id]/replace
 *
 * Replaces a virtual card: terminates the old card (auto-refunding any balance
 * to the wallet) and issues a brand-new card with a fresh PAN, CVV, and expiry.
 *
 * The new card inherits the old card's brand, type, and spending limit. The
 * old card's balance is NOT carried over — it's refunded to the wallet first,
 * so the user must explicitly fund the new card. This is the secure default:
 * a "replace" should never silently move balance to an unverified new PAN.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;

  try {
    // 1. Load the old card to inherit its properties.
    const oldCard = await enhancedCards.getCard(id, user.id);
    if (!oldCard) return errorJson("Card not found", 404, "NOT_FOUND");
    if (oldCard.status === "TERMINATED") return errorJson("Card is already terminated", 400, "CARD_TERMINATED");

    // 2. Terminate the old card (auto-refunds any balance to the wallet).
    await enhancedCards.terminateCard(id, user.id);

    // 3. Issue a replacement card with the same brand/type/limit.
    const newCard = await enhancedCards.createCard(user.id, {
      type: oldCard.type,
      brand: (oldCard.brand as "VISA" | "MASTERCARD") ?? "VISA",
      spendingLimitKobo: oldCard.spendingLimitKobo ?? undefined,
      cardholderName: oldCard.cardholderName ?? undefined,
    });

    // 4. Notify the user.
    notify.sendInApp({
      userId: user.id, type: "SECURITY", title: "Card Replaced",
      message: `Your virtual card ending ${oldCard.last4} has been terminated and replaced with a new card ending ${newCard.last4}. Any balance was refunded to your wallet.`,
      priority: "HIGH", actionUrl: "/cards", actionLabel: "View card",
    }).catch(() => null);

    return json({ data: newCard }, 201);
  } catch (e: any) {
    return errorJson(e.message ?? "Could not replace card", 400, "CARD_REPLACE_FAILED");
  }
}
