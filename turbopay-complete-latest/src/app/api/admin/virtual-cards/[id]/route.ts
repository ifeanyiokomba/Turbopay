import { enhancedCards } from "@/lib/turbocore/virtual-cards/enhanced";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

/**
 * PATCH /api/admin/virtual-cards/[id]
 *
 * Admin actions on a virtual card: freeze / unfreeze / terminate.
 * All actions are audit-logged with the admin's ID.
 */
const schema = z.object({
  action: z.enum(["freeze", "unfreeze", "terminate"]),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let admin; try { admin = await requirePermission(Permissions.ADMIN_MANAGE_USERS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  const { id } = await params;
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const actorId = user?.id ?? admin.id;
  try {
    if (parsed.data.action === "freeze") {
      await enhancedCards.adminFreeze(id, actorId);
      return json({ data: { ok: true, action: "frozen" } });
    }
    if (parsed.data.action === "terminate") {
      const result = await enhancedCards.adminTerminate(id, actorId);
      return json({ data: { ok: true, action: "terminated", refundedKobo: result.refundedKobo } });
    }
    // unfreeze — reuse the user-facing method but with admin actor
    await enhancedCards.unfreezeCard(id, admin.id);
    return json({ data: { ok: true, action: "unfrozen" } });
  } catch (e: any) {
    return errorJson(e.message, 400, "CARD_ACTION_FAILED");
  }
}
