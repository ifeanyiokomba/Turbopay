import { complianceCases } from "@/lib/turbocore/compliance/cases";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_COMPLIANCE_CASES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { searchParams } = new URL(req.url);
  const filter: any = {};
  if (searchParams.get("status")) filter.status = searchParams.get("status");
  if (searchParams.get("type")) filter.type = searchParams.get("type");
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  return json({ data: await complianceCases.listCases(filter, page) });
}

const schema = z.object({
  userId: z.string().min(1), type: z.enum(["STR", "REVIEW", "FREEZE", "OTHER"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]), description: z.string().min(2), amlFlagId: z.string().optional(),
});

export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_COMPLIANCE_CASES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  return json({ data: await complianceCases.openCase(parsed.data.userId, parsed.data.type, parsed.data.severity, parsed.data.description, parsed.data.amlFlagId, user ? { id: user.id, name: user.fullName } : undefined) }, 201);
}
