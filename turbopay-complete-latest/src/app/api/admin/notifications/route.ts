import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";

/**
 * ADMIN — notification log list with filters + pagination.
 * Filters: status (SENT|FAILED|PENDING), channel (SMS|EMAIL|PUSH), template, userId.
 */
export async function GET(req: Request) {
  try {
    await requirePermission(Permissions.ADMIN_VIEW);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const channel = searchParams.get("channel");
  const template = searchParams.get("template");
  const userId = searchParams.get("userId");
  const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = (page - 1) * limit;

  const where: any = {};
  if (status) where.status = status;
  if (channel) where.channel = channel;
  if (template) where.template = template;
  if (userId) where.userId = userId;

  const [total, items, byStatus, byChannel] = await Promise.all([
    db.notificationLog.count({ where }),
    db.notificationLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
    }),
    db.notificationLog.groupBy({ by: ["status"], _count: { _all: true } }),
    db.notificationLog.groupBy({ by: ["channel"], _count: { _all: true } }),
  ]);

  return json({
    data: {
      items: items.map((n) => ({
        id: n.id,
        userId: n.userId,
        user: n.user
          ? {
              id: n.user.id,
              fullName: n.user.fullName,
              emailMasked: maskEmail(n.user.email),
              phoneMasked: n.user.phone ? maskPhone(n.user.phone) : null,
            }
          : null,
        channel: n.channel,
        recipient: n.recipient, // already masked at write time
        template: n.template,
        status: n.status,
        provider: n.provider,
        messageId: n.messageId,
        errorMsg: n.errorMsg,
        metadata: n.metadata ? JSON.parse(n.metadata) : null,
        createdAt: n.createdAt.toISOString(),
      })),
      page,
      limit,
      total,
      hasMore: offset + items.length < total,
      stats: {
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
        byChannel: byChannel.map((c) => ({ channel: c.channel, count: c._count._all })),
      },
    },
  });
}
