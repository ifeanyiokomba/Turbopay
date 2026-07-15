import { requireAdmin } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";

/**
 * GET /api/admin/queue-health — Queue and background job health metrics.
 *
 * Returns pending/processing/failed counts for AsyncTask, OutboxEvent,
 * and NotificationLog. Cron health is derived from the CronLock table.
 */
export async function GET() {
  let admin;
  try { admin = await requireAdmin(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600_000);

  const [
    asyncTasks,
    outboxEvents,
    notifications,
    cronLocks,
  ] = await Promise.all([
    db.asyncTask.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    db.outboxEvent.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    db.notificationLog.groupBy({
      by: ["status"],
      _count: { id: true },
      where: { createdAt: { gte: oneHourAgo } },
    }),
    db.cronLock.findMany({
      select: { name: true, lockedAt: true, expiresAt: true },
    }),
  ]);

  const asyncTaskCounts = Object.fromEntries(asyncTasks.map((g) => [g.status, g._count.id]));
  const outboxCounts = Object.fromEntries(outboxEvents.map((g) => [g.status, g._count.id]));
  const notifCounts = Object.fromEntries(notifications.map((g) => [g.status, g._count.id]));

  const staleLocks = cronLocks.filter((l) => l.expiresAt && l.expiresAt > now);

  return json({
    data: {
      asyncTasks: {
        pending: asyncTaskCounts["PENDING"] ?? 0,
        processing: asyncTaskCounts["PROCESSING"] ?? 0,
        completed: asyncTaskCounts["COMPLETED"] ?? 0,
        failed: asyncTaskCounts["FAILED"] ?? 0,
      },
      outbox: {
        pending: outboxCounts["PENDING"] ?? 0,
        published: outboxCounts["PUBLISHED"] ?? 0,
        failed: outboxCounts["FAILED"] ?? 0,
      },
      notifications: {
        pending: (notifCounts["PENDING"] ?? 0) + (notifCounts["QUEUED"] ?? 0),
        sent: notifCounts["SENT"] ?? 0,
        failed: notifCounts["FAILED"] ?? 0,
        permanentlyFailed: notifCounts["PERMANENTLY_FAILED"] ?? 0,
      },
      cron: {
        activeLocks: staleLocks.length,
        jobs: staleLocks.map((l) => ({ name: l.name, lockedAt: l.lockedAt, expiresAt: l.expiresAt })),
      },
    },
  });
}
