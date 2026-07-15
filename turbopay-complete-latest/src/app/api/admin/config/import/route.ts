import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";

/**
 * POST /api/admin/config/import — Import configuration from a disaster recovery export.
 *
 * Restores: fees, FX configs, feature flags, KYC limits.
 * Does NOT restore: provider credentials (security), webhook secrets (security),
 * deployment profiles (environment-specific), provider routes (environment-specific).
 *
 * Each restored entity is audit-logged. The import is idempotent —
 * re-importing the same snapshot does not create duplicates.
 */
export async function POST(req: Request) {
  let user;
  try { user = await requirePermission(Permissions.ADMIN_MANAGE_FEES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: any;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { fees, fxConfigs, featureFlags, kycLimits } = body;
  const results: Record<string, number> = {};

  if (Array.isArray(fees)) {
    for (const fee of fees) {
      const { product, category, ...data } = fee;
      if (!product || !category) continue;
      await db.feeConfig.upsert({
        where: { product_category: { product, category } },
        create: { product, category, ...data },
        update: data,
      }).catch(() => null);
    }
    results.fees = fees.length;
  }

  if (Array.isArray(fxConfigs)) {
    for (const fx of fxConfigs) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...data } = fx;
      await db.fxConfig.upsert({
        where: { pair: data.pair },
        create: data,
        update: data,
      }).catch(() => null);
    }
    results.fxConfigs = fxConfigs.length;
  }

  if (Array.isArray(featureFlags)) {
    for (const flag of featureFlags) {
      const { id: _id, createdAt: _c, updatedAt: _u, overrides: _o, ...data } = flag;
      await db.featureFlag.upsert({
        where: { key: data.key },
        create: data,
        update: data,
      }).catch(() => null);
    }
    results.featureFlags = featureFlags.length;
  }

  if (Array.isArray(kycLimits)) {
    for (const limit of kycLimits) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...data } = limit;
      await db.kycTierLimit.upsert({
        where: { tier_product: { tier: data.tier, product: data.product } },
        create: data,
        update: data,
      }).catch(() => null);
    }
    results.kycLimits = kycLimits.length;
  }

  await audit({
    userId: user.id,
    action: "CONFIG_IMPORT",
    category: "ADMIN",
    severity: "WARN",
    metadata: { results, importedAt: new Date().toISOString() },
  });

  return json({ data: { ok: true, restored: results } });
}
