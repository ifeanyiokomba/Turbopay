import { serviceManagement } from "@/lib/turbocore/service-management";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await serviceManagement.list() });
}

const schema = z.object({ service: z.string().min(2), enabled: z.boolean() });

export async function PATCH(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FLAGS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  return json({ data: await serviceManagement.toggle(parsed.data.service, parsed.data.enabled) });
}
