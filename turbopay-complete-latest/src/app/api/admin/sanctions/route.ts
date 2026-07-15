import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { listEntries, addEntry } from "@/lib/turbocore/compliance/screening";
import { z } from "zod";

/**
 * GET /api/admin/sanctions — List sanctions entries.
 * POST /api/admin/sanctions — Add a new sanctions entry.
 */
export async function GET(req: Request) {
  try { await requirePermission(Permissions.ADMIN_VIEW_AUDIT); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { searchParams } = new URL(req.url);
  const listSource = searchParams.get("listSource") ?? undefined;
  const active = searchParams.get("active") !== null ? searchParams.get("active") === "true" : undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10) || 100, 500);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10) || 0;

  const entries = await listEntries({ listSource, active, limit, offset });
  return json({ data: entries });
}

const createSchema = z.object({
  name: z.string().min(1),
  listSource: z.enum(["OFAC_SDN", "UN_SANCTIONS", "EU_SANCTIONS", "CUSTOM"]),
  country: z.string().length(2).optional(),
  entityType: z.enum(["INDIVIDUAL", "ENTITY", "VESSEL"]).default("INDIVIDUAL"),
  reason: z.string().optional(),
});

export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_VIEW_AUDIT); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  const entry = await addEntry(parsed.data);
  return json({ data: entry }, 201);
}
