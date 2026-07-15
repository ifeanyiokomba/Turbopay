import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";

/**
 * ADMIN — latest reconciliation run report.
 * Permission: ADMIN_VIEW (read-only).
 */
export async function GET() {
  try {
    await requirePermission(Permissions.ADMIN_VIEW);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const latest = await db.reconciliationRun.findFirst({
    orderBy: { startedAt: "desc" },
  });
  if (!latest) {
    return json({ data: { run: null, message: "No reconciliation runs yet." } });
  }

  return json({
    data: {
      run: {
        id: latest.id,
        type: latest.type,
        status: latest.status,
        walletsChecked: latest.walletsChecked,
        driftDetected: latest.driftDetected,
        driftCorrected: latest.driftCorrected,
        metadata: latest.metadata ? JSON.parse(latest.metadata) : null,
        startedAt: latest.startedAt.toISOString(),
        completedAt: latest.completedAt?.toISOString() ?? null,
      },
    },
  });
}
