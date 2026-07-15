import { fx, FxError } from "@/lib/turbocore/fx";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

/** Decode a URL-encoded pair path param, e.g. "USD%E2%86%92NGN" → "USD→NGN". */
function decodePair(param: string): string {
  // The arrow → is URL-encoded as %E2%86%92. Next.js already decodes path
  // params, but double-decoding is safe (idempotent on plain text).
  return decodeURIComponent(param);
}

/** GET /api/admin/fx/[pair] — fetch a single pair config. */
export async function GET(_req: Request, ctx: { params: Promise<{ pair: string }> }) {
  try {
    await requirePermission(Permissions.ADMIN_MANAGE_FEES);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { pair: raw } = await ctx.params;
  const pair = decodePair(raw);
  try {
    const cfg = await fx.getSpread(pair);
    return json({ data: cfg });
  } catch (e: any) {
    if (e instanceof FxError) return errorJson(e.message, 404, e.code);
    throw e;
  }
}

const patchSchema = z.object({
  spreadBps: z.number().int().min(0).max(10_000).optional(),
  platformFeeBps: z.number().int().min(0).max(10_000).optional(),
  minAmountMinor: z.number().int().min(0).optional(),
  maxAmountMinor: z.number().int().min(0).nullable().optional(),
  enabled: z.boolean().optional(),
});

/** PATCH /api/admin/fx/[pair] — toggle enabled / update spread / etc. */
export async function PATCH(req: Request, ctx: { params: Promise<{ pair: string }> }) {
  try {
    await requirePermission(Permissions.ADMIN_MANAGE_FEES);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { pair: raw } = await ctx.params;
  const pair = decodePair(raw);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid body", 400);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  }
  try {
    const cfg = await fx.upsertConfig({ pair, ...parsed.data });
    return json({ data: cfg });
  } catch (e: any) {
    if (e instanceof FxError) return errorJson(e.message, 400, e.code);
    throw e;
  }
}

/** DELETE /api/admin/fx/[pair] — remove a pair config. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ pair: string }> }) {
  try {
    await requirePermission(Permissions.ADMIN_MANAGE_FEES);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { pair: raw } = await ctx.params;
  const pair = decodePair(raw);
  await fx.deleteConfig(pair);
  return json({ data: { pair, deleted: true } });
}
