/** Configurable KYC tier limits — DB-backed with hardcoded fallback. */
import { db } from "@/lib/db";
import { KYC_LIMITS, type KycTier } from "@/lib/turbopay/types";
import { recordConfigVersion } from "@/lib/turbocore/config/versioning";

class KycTierLimitService {
  async getLimits(tier: KycTier, product = "turbopay") {
    const row = await db.kycTierLimit.findFirst({ where: { tier, product, active: true } });
    if (row) return { singleTxKobo: row.singleTxMinor, dailyTxKobo: row.dailyTxMinor, balanceKobo: row.balanceMinor, label: row.label };
    return KYC_LIMITS[tier];
  }
  async list(product?: string) { return db.kycTierLimit.findMany({ where: product ? { product } : undefined, orderBy: [{ product: "asc" }, { tier: "asc" }] }); }
  async set(tier: number, product: string, input: { singleTxMinor: number; dailyTxMinor: number; balanceMinor: number; label: string }, actor?: { id: string; name: string }) {
    const existing = await db.kycTierLimit.findUnique({ where: { tier_product: { tier, product } } });
    const data = { tier, product, ...input, active: true };
    const result = existing ? await db.kycTierLimit.update({ where: { id: existing.id }, data }) : await db.kycTierLimit.create({ data });
    await recordConfigVersion("kycTierLimit", result.id, existing ? "UPDATE" : "CREATE", existing, result, undefined, actor);
    return result;
  }
}
export const kycLimits = new KycTierLimitService();
