import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { maskPhone, maskEmail, maskId } from "@/lib/turbopay/mask";

/**
 * ADMIN — KYC review queue.
 *  - filters: status (PENDING | VERIFIED | REJECTED), tier (1 | 2 | 3)
 *  - NIN / BVN are masked in the response (the encrypted-at-rest value is also
 *    hidden — operators only see masked representations for privacy).
 */
export async function GET(req: Request) {
  try {
    await requirePermission(Permissions.KYC_APPROVE);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // PENDING | VERIFIED | REJECTED
  const tier = searchParams.get("tier");
  const q = searchParams.get("q")?.trim();
  const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = (page - 1) * limit;

  const where: any = {};
  if (status) where.status = status;
  if (tier) where.tier = parseInt(tier, 10);
  if (q) {
    where.OR = [
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { phone: { contains: q } },
      { email: { contains: q } },
      { user: { fullName: { contains: q } } },
      { user: { email: { contains: q } } },
    ];
  }

  const [total, items] = await Promise.all([
    db.kycVerification.count({ where }),
    db.kycVerification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { user: { select: { id: true, fullName: true, email: true, phone: true, status: true, country: true } } },
    }),
  ]);

  return json({
    data: {
      items: items.map((k) => {
        // The `nin`/`bvn` columns are stored encrypted. For the admin queue we
        // surface only the masked last-4 (decoded form is unavailable without
        // an explicit decrypt call which we deliberately avoid here).
        const ninMasked = k.nin ? maskId(k.nin.replace(/[^0-9]/g, "").slice(-11) || "***********") : null;
        const bvnMasked = k.bvn ? maskId(k.bvn.replace(/[^0-9]/g, "").slice(-11) || "***********") : null;
        return {
          id: k.id,
          userId: k.userId,
          user: k.user
            ? {
                id: k.user.id,
                fullName: k.user.fullName,
                emailMasked: maskEmail(k.user.email),
                phoneMasked: k.user.phone ? maskPhone(k.user.phone) : null,
                status: k.user.status,
                country: k.user.country,
              }
            : null,
          tier: k.tier,
          status: k.status,
          provider: k.provider,
          ninMasked,
          bvnMasked,
          phoneMasked: k.phone ? k.phone ? maskPhone(k.phone) : null : null,
          emailMasked: k.email ? maskEmail(k.email) : null,
          firstName: k.firstName,
          lastName: k.lastName,
          middleName: k.middleName,
          verifiedAt: k.verifiedAt?.toISOString() ?? null,
          createdAt: k.createdAt.toISOString(),
        };
      }),
      page,
      limit,
      total,
      hasMore: offset + items.length < total,
    },
  });
}
