import { fees } from "@/lib/turbocore/fees";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

/** GET /api/admin/fees — list all fee configs. */
export async function GET() {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FEES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const list = await fees.list();
  return json({ data: list });
}

const setSchema = z.object({
  product: z.string().min(2),
  category: z.string().min(2),
  type: z.enum(["PERCENT", "FLAT"]),
  value: z.number().min(0),
  markupBps: z.number().min(0).max(10000).optional(),
  minFeeMinor: z.number().min(0).optional(),
  maxFeeMinor: z.number().min(0).nullable().optional(),
});

/** POST /api/admin/fees — set/update a fee config. */
export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FEES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = setSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  const { product, category, type, value, markupBps, minFeeMinor, maxFeeMinor } = parsed.data;
  const cfg = await fees.set(product, category, { type, value, markupBps: markupBps ?? 0, minFeeMinor: minFeeMinor ?? 0, maxFeeMinor: maxFeeMinor ?? null });
  return json({ data: cfg });
}
