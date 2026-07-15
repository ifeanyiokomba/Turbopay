import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";

/**
 * ADMIN — list team members (staff accounts only).
 * Team members are users whose role is anything other than "USER".
 */
export async function GET(req: Request) {
  try {
    await requirePermission(Permissions.ADMIN_MANAGE_TEAM);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = (page - 1) * limit;
  const role = searchParams.get("role");

  const where: any = { role: { not: "USER" } };
  if (role) where.role = role;

  const [total, items] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        emailVerified: true,
        phoneVerified: true,
        kycTier: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return json({
    data: {
      items: items.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        emailMasked: maskEmail(u.email),
        phone: u.phone,
        phoneMasked: u.phone ? maskPhone(u.phone) : null,
        role: u.role,
        status: u.status,
        emailVerified: u.emailVerified,
        phoneVerified: u.phoneVerified,
        kycTier: u.kycTier,
        avatarUrl: u.avatarUrl,
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
      })),
      page,
      limit,
      total,
      hasMore: offset + items.length < total,
    },
  });
}
