import { features } from "@/lib/turbocore/features";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

/** GET /api/admin/feature-flags — list all flags. */
export async function GET() {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FLAGS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const list = await features.list();
  return json({ data: list });
}

const schema = z.object({
  key: z.string().min(1),
  enabled: z.boolean().optional(),
  rollout: z.number().int().min(0).max(100).optional(),
  description: z.string().optional(),
  product: z.string().optional(),
});

/**
 * POST /api/admin/feature-flags — update or create a flag.
 * Accepts { key, enabled?, rollout?, description?, product? } and delegates
 * to features.setFlag(). At least one of enabled/rollout/description/product
 * must be present alongside key.
 */
export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FLAGS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  const { key, enabled, rollout, description, product } = parsed.data;

  // Resolve the effective `enabled` value. If the caller didn't supply one,
  // derive it from the rollout % (0 → off, >0 → on) so the rollout slider
  // can be the sole control.
  const effectiveEnabled = enabled ?? (rollout !== undefined ? rollout > 0 : undefined);
  if (effectiveEnabled === undefined) {
    return errorJson("Provide at least one of: enabled, rollout, description, product", 422, "VALIDATION");
  }

  const flag = await features.setFlag(key, effectiveEnabled, {
    ...(description !== undefined ? { description } : {}),
    ...(rollout !== undefined ? { rollout } : {}),
    ...(product !== undefined ? { product } : {}),
  });
  return json({ data: flag });
}
