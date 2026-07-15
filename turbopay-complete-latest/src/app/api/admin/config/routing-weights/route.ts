import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { getRoutingWeights, updateRoutingWeights, clearRoutingWeightsCache } from "@/lib/turbocore/config/routing-weights";
import { getConfigHistory } from "@/lib/turbocore/config/versioning";
import { z } from "zod";

/**
 * GET  /api/admin/config/routing-weights — current weights for local + FX
 * POST /api/admin/config/routing-weights — update weights for a rule-set
 *
 * Weights are stored in ConfigVersion (reuse of existing versioning primitive).
 * Behavior is identical to today when no DB config exists (falls back to hardcoded defaults).
 */

const weightsSchema = z.object({
  ruleSet: z.enum(["local", "fx"]),
  weights: z.record(z.string(), z.number().min(0).max(1)),
  reason: z.string().max(200).optional(),
});

export async function GET() {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FEES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const [localWeights, fxWeights, localHistory, fxHistory] = await Promise.all([
    getRoutingWeights("local"),
    getRoutingWeights("fx"),
    getConfigHistory("routingWeights", "local", 5),
    getConfigHistory("routingWeights", "fx", 5),
  ]);

  return json({
    data: {
      local: { weights: localWeights, history: localHistory },
      fx: { weights: fxWeights, history: fxHistory },
    },
  });
}

export async function POST(req: Request) {
  let actor;
  try { actor = await requirePermission(Permissions.ADMIN_MANAGE_FEES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = weightsSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  await updateRoutingWeights(parsed.data.ruleSet, parsed.data.weights, { id: actor.id, name: actor.fullName });

  return json({ data: { ok: true, ruleSet: parsed.data.ruleSet, weights: parsed.data.weights } });
}
