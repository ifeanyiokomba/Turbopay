import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { notify, MAX_NOTIFICATION_RETRIES } from "@/lib/turbocore/notifications";

/**
 * ADMIN — retry a failed notification (one-shot manual retry).
 *
 * Re-resolves the recipient from the user row (the NotificationLog stores a
 * masked recipient), then re-dispatches via the notification service. The
 * retry attempt is recorded as a new NotificationLog row AND the original is
 * updated in place:
 *   - on success: original.status → SENT (so the retry queue stops picking it up)
 *   - on failure: original.retryCount++, and if it crosses MAX_NOTIFICATION_RETRIES
 *     the original is marked PERMANENTLY_FAILED.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requirePermission(Permissions.ADMIN_MANAGE_NOTIFICATIONS);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { id } = await params;

  const original = await db.notificationLog.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!original) return errorJson("Notification not found", 404, "NOT_FOUND");
  if (original.status === "SENT") {
    return errorJson("Notification was already sent; nothing to retry", 409, "ALREADY_SENT");
  }
  if (original.status === "PERMANENTLY_FAILED") {
    return errorJson(
      "Notification is permanently failed (exhausted retries); cannot retry",
      409,
      "PERMANENTLY_FAILED",
    );
  }

  // We need a real recipient — prefer the user's email/phone (channel-dependent).
  let recipient: string | null = null;
  if (original.user) {
    if (original.channel === "EMAIL") recipient = original.user.email;
    else if (original.channel === "SMS") recipient = original.user.phone;
  }
  if (!recipient) {
    // Without a real recipient we cannot actually re-dispatch — mark the
    // original as permanently failed with a clear reason.
    await db.notificationLog.update({
      where: { id },
      data: { status: "PERMANENTLY_FAILED", errorMsg: "no_resolvable_recipient" },
    });
    await audit({
      userId: actor.id,
      action: "NOTIFICATION_RETRY_SKIPPED",
      category: "ADMIN",
      severity: "WARN",
      metadata: {
        notificationId: id,
        reason: "no_resolvable_recipient",
      },
    });
    return errorJson(
      "Cannot retry: no resolvable recipient (user missing or channel unknown).",
      409,
      "NO_RECIPIENT"
    );
  }

  // Re-dispatch through the notification service. It writes its own
  // NotificationLog row for this retry attempt.
  const variables = original.metadata
    ? (JSON.parse(original.metadata) as Record<string, string | number>)
    : {};
  const result = await notify.send({
    to: recipient,
    channel: original.channel as "SMS" | "EMAIL" | "PUSH",
    template: original.template,
    variables,
    userId: original.userId ?? undefined,
  });

  // Update the original NotificationLog so the retry queue stays in sync.
  if (result.delivered) {
    await db.notificationLog.update({
      where: { id },
      data: {
        status: "SENT",
        retryCount: { increment: 1 },
        messageId: result.messageId ?? null,
        errorMsg: null,
      },
    });
  } else {
    const newRetryCount = original.retryCount + 1;
    const isPermanent = newRetryCount >= MAX_NOTIFICATION_RETRIES;
    await db.notificationLog.update({
      where: { id },
      data: {
        status: isPermanent ? "PERMANENTLY_FAILED" : "FAILED",
        retryCount: { increment: 1 },
        errorMsg: result.error ?? "unknown",
      },
    });
  }

  await audit({
    userId: actor.id,
    action: "NOTIFICATION_RETRY_TRIGGERED",
    category: "ADMIN",
    severity: result.delivered ? "INFO" : "WARN",
    metadata: {
      originalNotificationId: id,
      channel: original.channel,
      template: original.template,
      delivered: result.delivered,
      error: result.error ?? null,
      triggeredBy: actor.id,
    },
  });

  return json({
    data: {
      originalNotificationId: id,
      delivered: result.delivered,
      error: result.error ?? null,
    },
  });
}
