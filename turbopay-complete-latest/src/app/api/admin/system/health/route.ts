import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { listProviders } from "@/lib/turbocore/providers/registry";
import { cache, cacheAside } from "@/lib/turbocore/cache";

/**
 * ADMIN — comprehensive platform health check.
 * Returns: DB status, Redis status, provider registry snapshot, and key
 * platform stats. The entire response is cached for 30 seconds to avoid
 * running 13+ count queries on every dashboard refresh.
 */
export async function GET() {
  try {
    await requirePermission(Permissions.SYSTEM_VIEW_HEALTH);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  // Cache the full health snapshot for 30s — the count queries are
  // expensive and the admin dashboard polls frequently.
  const data = await cacheAside("admin:system:health", 30_000, async () => {
    // --- DB ping ---
    let dbStatus: "healthy" | "degraded" | "down" = "healthy";
    let dbLatencyMs: number | null = null;
    try {
      const t0 = Date.now();
      await db.user.count({ take: 1 });
      dbLatencyMs = Date.now() - t0;
    } catch {
      dbStatus = "down";
    }

    // --- Redis status — detected via the distributed cache layer. ---
    const isDistributed = cache.isDistributed();
    const redis = {
      status: isDistributed ? ("connected" as const) : ("not_configured" as const),
      note: isDistributed
        ? "Redis connected — rate limiting, circuit breaker, and caches are distributed across all instances."
        : "Redis not configured — using in-memory fallback (single-instance only). Set REDIS_URL for multi-instance deployments.",
    };

    // --- Provider registry snapshot ---
    const providerList = await listProviders();
    const providers = providerList.map((p) => ({
      contract: p.contract,
      name: p.name,
      mode: p.mode,
    }));

    // --- Key platform stats (all in parallel) ---
    const [
      userCount,
      activeUserCount,
      walletCount,
      frozenWalletCount,
      txCount,
      successTxCount,
      pendingTxCount,
      failedTxCount,
      unresolvedAmlFlags,
      openComplianceCases,
      pendingKyc,
      webhookPending,
      lastReconciliation,
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { status: "ACTIVE" } }),
      db.wallet.count(),
      db.wallet.count({ where: { status: "FROZEN" } }),
      db.transaction.count(),
      db.transaction.count({ where: { status: "SUCCESS" } }),
      db.transaction.count({ where: { status: "PENDING" } }),
      db.transaction.count({ where: { status: "FAILED" } }),
      db.amlFlag.count({ where: { resolved: false } }),
      db.complianceCase.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
      db.kycVerification.count({ where: { status: "PENDING" } }),
      db.webhookEvent.count({ where: { status: "PENDING" } }),
      db.reconciliationRun.findFirst({ orderBy: { startedAt: "desc" } }),
    ]);

    // --- Recent audit log activity (24h) ---
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const [recentAuditCount, criticalAuditCount] = await Promise.all([
      db.auditLog.count({ where: { createdAt: { gte: since24h } } }),
      db.auditLog.count({ where: { createdAt: { gte: since24h }, severity: "CRITICAL" } }),
    ]);

    const overall: "healthy" | "degraded" | "down" =
      dbStatus === "down" ? "down" : unresolvedAmlFlags > 0 || frozenWalletCount > 0 ? "degraded" : "healthy";

    return {
      overall,
      timestamp: new Date().toISOString(),
      database: { status: dbStatus, latencyMs: dbLatencyMs },
      redis,
      providers,
      stats: {
        users: { total: userCount, active: activeUserCount },
        wallets: { total: walletCount, frozen: frozenWalletCount },
        transactions: {
          total: txCount,
          success: successTxCount,
          pending: pendingTxCount,
          failed: failedTxCount,
        },
        risk: {
          unresolvedAmlFlags,
          openComplianceCases,
          pendingKyc,
        },
        operations: {
          pendingWebhooks: webhookPending,
          recentAuditEvents24h: recentAuditCount,
          criticalAuditEvents24h: criticalAuditCount,
        },
        reconciliation: lastReconciliation
          ? {
              id: lastReconciliation.id,
              type: lastReconciliation.type,
              status: lastReconciliation.status,
              walletsChecked: lastReconciliation.walletsChecked,
              driftDetected: lastReconciliation.driftDetected,
              driftCorrected: lastReconciliation.driftCorrected,
              startedAt: lastReconciliation.startedAt.toISOString(),
              completedAt: lastReconciliation.completedAt?.toISOString() ?? null,
            }
          : null,
      },
    };
  });

  return json({ data });
}
