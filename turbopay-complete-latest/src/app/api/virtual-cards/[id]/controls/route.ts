import { requireUser } from "@/lib/turbopay/auth";
import { enhancedCards } from "@/lib/turbocore/virtual-cards/enhanced";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  try { return json({ data: await enhancedCards.getControls(id, user.id) }); }
  catch (e: any) { return errorJson(e.message, 404); }
}

const schema = z.object({
  onlinePaymentsEnabled: z.boolean().optional(), internationalEnabled: z.boolean().optional(),
  atmEnabled: z.boolean().optional(), dailyLimitKobo: z.number().int().optional(),
  monthlyLimitKobo: z.number().int().optional(), merchantCategories: z.string().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson("Invalid", 422, "VALIDATION");
  try { return json({ data: await enhancedCards.updateControls(id, user.id, parsed.data) }); }
  catch (e: any) { return errorJson(e.message, 404); }
}
