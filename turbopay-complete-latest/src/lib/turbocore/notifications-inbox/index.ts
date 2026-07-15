import { db } from "@/lib/db";

class NotificationInboxService {
  async list(userId: string, filter?: { unreadOnly?: boolean; type?: string }) {
    const where: Record<string, unknown> = { userId };
    if (filter?.unreadOnly) where.read = false;
    if (filter?.type) where.type = filter.type;
    return db.inAppNotification.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return db.inAppNotification.count({ where: { userId, read: false } });
  }

  async markRead(id: string, userId: string) {
    await db.inAppNotification.updateMany({ where: { id, userId }, data: { read: true, readAt: new Date() } });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await db.inAppNotification.updateMany({ where: { userId, read: false }, data: { read: true, readAt: new Date() } });
    return { ok: true };
  }

  /** Create a notification (called internally by other services). */
  async create(input: { userId: string; type: string; title: string; message: string; priority?: string; actionUrl?: string; actionLabel?: string; metadata?: Record<string, unknown> }) {
    return db.inAppNotification.create({
      data: { userId: input.userId, type: input.type, title: input.title, message: input.message, priority: input.priority ?? "NORMAL", actionUrl: input.actionUrl, actionLabel: input.actionLabel, metadata: input.metadata ? JSON.stringify(input.metadata) : null },
    });
  }

  async delete(id: string, userId: string) {
    await db.inAppNotification.deleteMany({ where: { id, userId } });
    return { ok: true };
  }
}

export const notificationInbox = new NotificationInboxService();
