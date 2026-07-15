import { reconciliation } from "@/lib/turbocore/reconciliation";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";

/**
 * ADMIN — trigger a manual reconciliation run.
 * Permission: ADMIN_RUN_RECONCILIATION (high-trust finance operation).
 */
export async function POST() {
  let actor;
  try {
    actor = await requirePermission(Permissions.ADMIN_RUN_RECONCILIATION);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const result = await reconciliation.runAll("MANUAL");

  await audit({
    userId: actor.id,
    action: "RECONCILIATION_RUN_TRIGGERED",
    category: "ADMIN",
    severity: "WARN",
    metadata: {
      runId: result.runId,
      walletsChecked: result.walletsChecked,
      driftDetected: result.driftDetected,
      driftCorrected: result.driftCorrected,
      triggeredBy: actor.id,
      triggeredByName: actor.fullName,
    },
  });

  return json({
    data: {
      runId: result.runId,
      walletsChecked: result.walletsChecked,
      driftDetected: result.driftDetected,
      driftCorrected: result.driftCorrected,
      drifts: result.drifts,
    },
  });
}
