import { requireAdmin } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { z } from "zod";

const schema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  targetVersion: z.number().int().min(1),
  reason: z.string().min(3),
});

/**
 * POST /api/admin/config/rollback — Rollback a configuration to a previous version.
 *
 * Restores the configuration state from a specific version in the ConfigVersion table.
 * This is a one-click rollback mechanism for operational recovery.
 *
 * Body: { entityType, entityId, targetVersion, reason }
 */
export async function POST(req: Request) {
  let admin;
  try { admin = await requireAdmin(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const { entityType, entityId, targetVersion, reason } = parsed.data;

  // Find the target version
  const targetVersionRecord = await db.configVersion.findFirst({
    where: { entityType, entityId, version: targetVersion },
  });
  if (!targetVersionRecord) {
    return errorJson("Version not found", 404, "VERSION_NOT_FOUND");
  }

  // Get the 'after' state from the target version (the state we want to restore)
  if (!targetVersionRecord.after) {
    return errorJson("Version has no state to restore", 400, "NO_STATE");
  }

  const restoreState = JSON.parse(targetVersionRecord.after);

  // Apply the restoration based on entity type
  try {
    switch (entityType) {
      case "fee":
        await db.feeConfig.update({
          where: { id: entityId },
          data: {
            type: restoreState.type ?? undefined,
            value: restoreState.value ?? undefined,
            minFeeMinor: restoreState.minFeeMinor ?? undefined,
            maxFeeMinor: restoreState.maxFeeMinor ?? undefined,
            active: restoreState.active ?? undefined,
          },
        });
        break;
      case "fx":
        await db.fxConfig.update({
          where: { id: entityId },
          data: {
            spreadBps: restoreState.spreadBps ?? undefined,
            platformFeeBps: restoreState.platformFeeBps ?? undefined,
            enabled: restoreState.enabled ?? undefined,
          },
        });
        break;
      case "feature_flag":
        await db.featureFlag.update({
          where: { id: entityId },
          data: {
            enabled: restoreState.enabled ?? undefined,
            rollout: restoreState.rollout ?? undefined,
          },
        });
        break;
      case "kyc_limit":
        await db.kycTierLimit.update({
          where: { id: entityId },
          data: {
            singleTxMinor: restoreState.singleTxMinor ?? undefined,
            dailyTxMinor: restoreState.dailyTxMinor ?? undefined,
            balanceMinor: restoreState.balanceMinor ?? undefined,
          },
        });
        break;
      case "service":
        await db.serviceFlag.update({
          where: { id: entityId },
          data: { enabled: restoreState.enabled ?? undefined },
        });
        break;
      default:
        return errorJson(`Unsupported entity type for rollback: ${entityType}`, 400, "UNSUPPORTED_ENTITY");
    }
  } catch (e: any) {
    return errorJson(`Rollback failed: ${e.message}`, 500, "ROLLBACK_FAILED");
  }

  // Record the rollback as a new config version
  const lastVersion = await db.configVersion.findFirst({
    where: { entityType, entityId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const newVersion = (lastVersion?.version ?? 0) + 1;

  await db.configVersion.create({
    data: {
      entityType,
      entityId,
      action: "ROLLBACK",
      before: JSON.stringify(restoreState),
      after: JSON.stringify(restoreState),
      reason: `Rolled back to version ${targetVersion}: ${reason}`,
      changedBy: admin.id,
      changedByName: admin.fullName,
      version: newVersion,
    },
  });

  await audit({
    userId: admin.id,
    action: "CONFIG_ROLLBACK",
    category: "ADMIN",
    metadata: { entityType, entityId, targetVersion, newVersion, reason },
  });

  return json({
    data: {
      rolledBack: true,
      entityType,
      entityId,
      targetVersion,
      newVersion,
    },
  });
}
