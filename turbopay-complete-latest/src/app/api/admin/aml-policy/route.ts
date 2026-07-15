import { amlPolicy } from "@/lib/turbocore/config/aml-policy";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  try { await requirePermission(Permissions.ADMIN_MANAGE_AML_POLICY); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await amlPolicy.list() });
}

const schema = z.object({ name: z.string().min(2), description: z.string().optional(), policy: z.record(z.string(), z.unknown()) });

export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_AML_POLICY); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  return json({ data: await amlPolicy.create(parsed.data.name, parsed.data.policy as any, parsed.data.description, user ? { id: user.id, name: user.fullName } : undefined) }, 201);
}

export async function PATCH(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_AML_POLICY); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action"); const id = searchParams.get("id");
  if (action === "activate" && id) return json({ data: await amlPolicy.activate(id, user ? { id: user.id, name: user.fullName } : undefined) });
  return errorJson("Unknown action", 400);
}
