import { requireUser } from "@/lib/turbopay/auth";
import { enhancedCards } from "@/lib/turbocore/virtual-cards/enhanced";
import { errorJson, json } from "@/lib/turbopay/api";

/**
 * POST /api/virtual-cards/[id]/reveal
 *
 * Decrypts the card's PAN + CVV on-demand. The encrypted values are NEVER
 * returned in list/get responses — only through this explicit endpoint.
 * Every call is audit-logged (CARD_DETAILS_REVEALED) so the user can see
 * every reveal in their security timeline.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  try {
    const details = await enhancedCards.revealCardDetails(id, user.id);
    return json({ data: details });
  } catch (e: any) { return errorJson(e.message, 400, "REVEAL_FAILED"); }
}
