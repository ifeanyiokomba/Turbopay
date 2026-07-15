import { requireUser } from "@/lib/turbopay/auth";
import { enhancedCards } from "@/lib/turbocore/virtual-cards/enhanced";
import { features } from "@/lib/turbocore/features";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const enabled = await features.isEnabled("virtual_cards", user.id);
  if (!enabled) return errorJson("Virtual cards are not available yet.", 403, "FEATURE_DISABLED");
  return json({ data: await enhancedCards.listCards(user.id) });
}

const schema = z.object({
  type: z.enum(["VIRTUAL", "PHYSICAL"]).default("VIRTUAL"),
  spendingLimitKobo: z.number().int().optional(),
  brand: z.enum(["VISA", "MASTERCARD"]).default("VISA"),
  cardholderName: z.string().min(2).max(50).optional(),
});

export async function POST(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const enabled = await features.isEnabled("virtual_cards", user.id);
  if (!enabled) return errorJson("Virtual cards are not available yet.", 403, "FEATURE_DISABLED");
  let body; try { body = await req.json(); } catch { body = {}; }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  try {
    const card = await enhancedCards.createCard(user.id, parsed.data);
    return json({ data: card }, 201);
  } catch (e: any) { return errorJson(e.message, 400, "CARD_ISSUE_FAILED"); }
}
