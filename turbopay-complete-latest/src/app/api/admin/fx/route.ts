import { fx, seedDefaultFxConfigs } from "@/lib/turbocore/fx";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

/** GET /api/admin/fx — list all FxConfig pairs. */
export async function GET() {
  try {
    await requirePermission(Permissions.ADMIN_MANAGE_FEES);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  // Lazy-seed defaults if the table is empty (idempotent).
  await seedDefaultFxConfigs();
  const list = await fx.listConfigs();
  return json({ data: list });
}

const upsertSchema = z.object({
  pair: z
    .string()
    .regex(/^[A-Z]{3}→[A-Z]{3}$/, "pair must be 'XXX→YYY' (e.g. USD→NGN)"),
  spreadBps: z.number().int().min(0).max(10_000).optional(),
  platformFeeBps: z.number().int().min(0).max(10_000).optional(),
  minAmountMinor: z.number().int().min(0).optional(),
  maxAmountMinor: z.number().int().min(0).nullable().optional(),
  enabled: z.boolean().optional(),
});

/** POST /api/admin/fx — upsert a pair's FxConfig. */
export async function POST(req: Request) {
  try {
    await requirePermission(Permissions.ADMIN_MANAGE_FEES);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid body", 400);
  }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  }
  const cfg = await fx.upsertConfig(parsed.data);
  return json({ data: cfg }, 200);
}
