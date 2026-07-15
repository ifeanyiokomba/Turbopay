import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { cacheAside } from "@/lib/turbocore/cache";

/**
 * ADMIN — total user balances ("float") on the platform.
 * Sums all wallet caches and compares to the ledger-derived total.
 *
 * Performance: the ledger aggregate (sum of ALL credit - ALL debit entries
 * ever) is an O(n) scan of the immutable ledger — at scale this is billions
 * of rows. The entire response is cached for 5 minutes (cacheAside) so the
 * admin dashboard doesn't trigger a full-ledger scan on every load.
 *
 * For true production scale, the total should be maintained as a running
 * SystemMetric singleton (updated by a periodic reconciliation cron) instead
 * of aggregated on-demand. The cache is a stop-gap until that lands.
 */
export async function GET() {
  try {
    await requirePermission(Permissions.ADMIN_VIEW);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const data = await cacheAside("admin:finance:float", 5 * 60 * 1000, async () => {
    const [walletAgg, creditAgg, debitAgg, walletCount, activeWallets, frozenWallets, topWallets] = await Promise.all([
      db.wallet.aggregate({ _sum: { balanceKobo: true }, _avg: { balanceKobo: true }, _max: { balanceKobo: true } }),
      db.ledgerEntry.aggregate({ where: { entryType: "CREDIT" }, _sum: { amountKobo: true } }),
      db.ledgerEntry.aggregate({ where: { entryType: "DEBIT" }, _sum: { amountKobo: true } }),
      db.wallet.count(),
      db.wallet.count({ where: { status: "ACTIVE" } }),
      db.wallet.count({ where: { status: "FROZEN" } }),
      db.wallet.findMany({
        orderBy: { balanceKobo: "desc" },
        take: 20,
        select: {
          id: true,
          userId: true,
          balanceKobo: true,
          currency: true,
          status: true,
          user: { select: { id: true, fullName: true, email: true, status: true } },
        },
      }),
    ]);

    const totalCachedKobo = walletAgg._sum.balanceKobo ?? 0;
    const totalLedgerKobo = (creditAgg._sum.amountKobo ?? 0) - (debitAgg._sum.amountKobo ?? 0);
    const driftKobo = totalCachedKobo - totalLedgerKobo;

    return {
      totals: {
        totalCachedKobo,
        totalLedgerKobo,
        driftKobo,
        reconciled: driftKobo === 0,
        averageBalanceKobo: Math.round(walletAgg._avg.balanceKobo ?? 0),
        maxBalanceKobo: walletAgg._max.balanceKobo ?? 0,
      },
      wallets: {
        total: walletCount,
        active: activeWallets,
        frozen: frozenWallets,
      },
      topWallets: topWallets.map((w) => ({
        walletId: w.id,
        userId: w.userId,
        userName: w.user?.fullName ?? null,
        balanceKobo: w.balanceKobo,
        currency: w.currency,
        status: w.status,
        userStatus: w.user?.status ?? null,
      })),
    };
  });

  return json({ data });
}
