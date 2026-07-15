import { webhookManagement } from "@/lib/turbocore/config/webhook-management";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";

/**
 * POST /api/admin/webhooks/events/[id]/retry
 *
 * Retries a FAILED webhook event by re-processing it through the registry.
 * The event is marked PENDING and the registry pipeline re-runs:
 *   signature verify (skipped on retry — already verified) → normalize → dispatch.
 *
 * This is the recovery path for events that failed due to transient business-
 * logic errors (e.g. a DB timeout during wallet credit). The admin can
 * manually retry from the Webhook Management UI.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let admin; try { admin = await requirePermission(Permissions.ADMIN_MANAGE_WEBHOOKS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  const { id } = await params;
  try {
    const result = await webhookManagement.retryEvent(id, user ? { id: user.id, name: user.fullName } : { id: admin.id, name: "admin" });
    return json({ data: result });
  } catch (e: any) {
    return errorJson(e.message, 404, "NOT_FOUND");
  }
}
