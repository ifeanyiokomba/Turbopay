import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";

/**
 * ADMIN — list customers with search + filters + pagination.
 * Permission: ADMIN_VIEW. Phones are masked in the response.
 */
export async function GET(req: Request) {
  try {
    await requirePermission(Permissions.ADMIN_VIEW);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const status = searchParams.get("status"); // ACTIVE | FROZEN | SUSPENDED | CLOSED
  const kycTier = searchParams.get("kycTier");
  const kycStatus = searchParams.get("kycStatus"); // UNVERIFIED | PENDING | VERIFIED | REJECTED
  const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = (page - 1) * limit;

  const where: any = {};
  if (status) where.status = status;
  if (kycStatus) where.kycStatus = kycStatus;
  if (kycTier) where.kycTier = parseInt(kycTier, 10);
  if (q) {
    where.OR = [
      { fullName: { contains: q } },
      { email: { contains: q } },
      { phone: { contains: q } },
    ];
  }

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
        kycTier: true,
        kycStatus: true,
        status: true,
        role: true,
        emailVerified: true,
        phoneVerified: true,
        createdAt: true,
        wallet: { select: { id: true, balanceKobo: true, status: true, currency: true } },
      },
    }),
  ]);

  // Audit the list access (read-only, INFO).
  const actor = await getSessionUser();
  await audit({
    userId: actor?.id ?? null,
    action: "ADMIN_CUSTOMERS_LIST_VIEWED",
    category: "ADMIN",
    severity: "INFO",
    metadata: { q, status, kycTier, kycStatus, page, limit, total },
  });

  return json({
    data: {
      items: items.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        emailMasked: maskEmail(u.email),
        phone: u.phone,
        phoneMasked: u.phone ? maskPhone(u.phone) : null,
        kycTier: u.kycTier,
        kycStatus: u.kycStatus,
        status: u.status,
        role: u.role,
        emailVerified: u.emailVerified,
        phoneVerified: u.phoneVerified,
        createdAt: u.createdAt.toISOString(),
        wallet: u.wallet
          ? {
              id: u.wallet.id,
              balanceKobo: u.wallet.balanceKobo,
              currency: u.wallet.currency,
              status: u.wallet.status,
            }
          : null,
      })),
      page,
      limit,
      total,
      hasMore: offset + items.length < total,
    },
  });
}
