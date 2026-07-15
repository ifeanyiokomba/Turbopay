import { requireUser, AuthError } from "@/lib/turbopay/auth";
import { rbac, Permissions } from "@/lib/turbocore/rbac";
import { notify } from "@/lib/turbocore/notifications";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { z } from "zod";

/**
 * ADMIN — Broadcast a platform-wide announcement to ALL active users.
 *
 * RBAC: requires ADMIN_MANAGE_NOTIFICATIONS OR ADMIN_VIEW (either grants
 * access). The OR semantics support a future "comms-only" admin role that
 * has broadcast rights but not full admin visibility, while still allowing
 * any full admin to broadcast.
 *
 * The notification service creates one InAppNotification row per active
 * user (type = SYSTEM) via `broadcastAnnouncement`. The route returns the
 * count of recipients so the admin UI can show a confirmation toast.
 */
const schema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(140),
  message: z.string().min(2, "Message must be at least 2 characters").max(1000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  actionUrl: z.string().max(200).optional(),
  actionLabel: z.string().max(60).optional(),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  // RBAC OR check — accept either ADMIN_MANAGE_NOTIFICATIONS or ADMIN_VIEW.
  const canBroadcast =
    (await rbac.hasPermission(user.role, Permissions.ADMIN_MANAGE_NOTIFICATIONS)) ||
    (await rbac.hasPermission(user.role, Permissions.ADMIN_VIEW));
  if (!canBroadcast) {
    const err = new AuthError("FORBIDDEN", "Missing permission: admin broadcast", 403);
    return errorJson(err.message, err.status, err.code);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");
  }

  const { title, message, priority, actionUrl, actionLabel } = parsed.data;
  const result = await notify.broadcastAnnouncement({
    title,
    message,
    priority,
    actionUrl,
    actionLabel,
  });

  await audit({
    userId: user.id,
    action: "ADMIN_BROADCAST_ANNOUNCEMENT",
    category: "ADMIN",
    severity: "INFO",
    metadata: {
      title,
      messagePreview: message.slice(0, 80),
      priority: priority ?? "NORMAL",
      recipients: result.sent,
      actionUrl: actionUrl ?? null,
      actionLabel: actionLabel ?? null,
    },
  });

  return json({ data: { sent: result.sent } });
}
