import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

/** GET /api/admin/webhooks — list recent webhook events (monitoring). */
export async function GET() {
  try { await requirePermission(Permissions.ADMIN_VIEW_WEBHOOKS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const events = await db.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 100 });
  return json({ data: events });
}
