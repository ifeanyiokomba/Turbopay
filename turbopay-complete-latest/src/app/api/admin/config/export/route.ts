import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";

/**
 * POST /api/admin/config/export — Export all configuration for disaster recovery.
 *
 * Returns a JSON snapshot containing: fees, FX configs, feature flags,
 * provider configs (credentials redacted), provider routes, KYC limits,
 * AML policies, deployment profiles, and webhook endpoints.
 *
 * Sensitive fields (credentials, secrets, passwords) are automatically
 * redacted — this export is safe to store externally.
 */
export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FEES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const [fees, fxConfigs, featureFlags, providerConfigs, providerRoutes, kycLimits, amlPolicies, deploymentProfiles, webhookEndpoints] = await Promise.all([
    db.feeConfig.findMany({ orderBy: { product: "asc" } }),
    db.fxConfig.findMany({ orderBy: { pair: "asc" } }),
    db.featureFlag.findMany({ orderBy: { key: "asc" }, include: { overrides: true } }),
    db.providerConfig.findMany({ orderBy: { contract: "asc" }, select: { id: true, contract: true, providerName: true, mode: true, priority: true, enabled: true, credentialKeys: true } }),
    db.providerRoute.findMany({ orderBy: { contract: "asc" } }),
    db.kycTierLimit.findMany({ orderBy: { tier: "asc" } }),
    db.amlPolicy.findMany({ orderBy: { createdAt: "desc" } }),
    db.deploymentProfile.findMany({ orderBy: { name: "asc" } }),
    db.webhookEndpoint.findMany({ orderBy: { providerName: "asc" }, select: { id: true, providerName: true, url: true, enabled: true, maxRetries: true } }),
  ]);

  return json({
    data: {
      exportedAt: new Date().toISOString(),
      fees,
      fxConfigs,
      featureFlags,
      providerConfigs,
      providerRoutes,
      kycLimits,
      amlPolicies,
      deploymentProfiles: deploymentProfiles.map((p) => ({ ...p, config: JSON.parse(p.config as string) })),
      webhookEndpoints,
    },
  });
}
