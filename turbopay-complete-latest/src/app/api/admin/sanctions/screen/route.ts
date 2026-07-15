import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { screenName } from "@/lib/turbocore/compliance/screening";
import { z } from "zod";

/**
 * POST /api/admin/sanctions/screen — Screen a name against the sanctions list.
 * Does NOT persist or auto-action — returns results for admin review.
 */
const schema = z.object({
  fullName: z.string().min(1),
  nationality: z.string().length(2).optional(),
  listSource: z.string().optional(),
});

export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_VIEW_AUDIT); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  const result = await screenName(parsed.data.fullName, {
    nationality: parsed.data.nationality,
    listSource: parsed.data.listSource,
  });

  return json({ data: result });
}
