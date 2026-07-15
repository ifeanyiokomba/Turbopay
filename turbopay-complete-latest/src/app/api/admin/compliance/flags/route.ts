import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";

/**
 * ADMIN — list AML flags.
 * Filters: resolved (true|false), severity (LOW|MEDIUM|HIGH), userId.
 * Permission: AML_VIEW.
 */
export async function GET(req: Request) {
  try {
    await requirePermission(Permissions.AML_VIEW);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const { searchParams } = new URL(req.url);
  const resolved = searchParams.get("resolved"); // "true" | "false"
  const severity = searchParams.get("severity"); // LOW | MEDIUM | HIGH
  const userId = searchParams.get("userId");
  const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = (page - 1) * limit;

  const where: any = {};
  if (resolved === "true") where.resolved = true;
  if (resolved === "false") where.resolved = false;
  if (severity) where.severity = severity;
  if (userId) where.userId = userId;

  const [total, items] = await Promise.all([
    db.amlFlag.count({ where }),
    db.amlFlag.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
    }),
  ]);

  return json({
    data: {
      items: items.map((f) => ({
        id: f.id,
        userId: f.userId,
        user: f.user
          ? {
              id: f.user.id,
              fullName: f.user.fullName,
              emailMasked: maskEmail(f.user.email),
              phoneMasked: f.user.phone ? maskPhone(f.user.phone) : null,
            }
          : null,
        rule: f.rule,
        severity: f.severity,
        description: f.description,
        resolved: f.resolved,
        resolvedAt: f.resolvedAt?.toISOString() ?? null,
        metadata: f.metadata ? JSON.parse(f.metadata) : null,
        createdAt: f.createdAt.toISOString(),
      })),
      page,
      limit,
      total,
      hasMore: offset + items.length < total,
    },
  });
}
