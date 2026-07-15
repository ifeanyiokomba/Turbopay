/**
 * TurboCore — Reconciliation Engine
 * ===================================
 *
 * Detects + corrects drift between the wallet balance cache and the ledger
 * (source of truth). Runs as a daily job + on-demand from the admin panel.
 *
 * The ledger is always authoritative. If a wallet's cached balanceKobo
 * differs from the ledger sum, the cache is corrected and a ReconciliationRun
 * record is logged with the drift details.
 */

import { db } from "@/lib/db";
import { getLedgerBalance } from "@/lib/turbopay/ledger";
import { audit } from "@/lib/turbopay/audit";

export interface ReconciliationResult {
  runId: string;
  walletsChecked: number;
  driftDetected: number;
  driftCorrected: number;
  drifts: Array<{ walletId: string; userId: string; cached: number; ledger: number; delta: number }>;
}

class ReconciliationService {
  /** Run a full reconciliation across all wallets (cursor-based, batched). */
  async runAll(type: "DAILY" | "MONTHLY" | "MANUAL" = "DAILY"): Promise<ReconciliationResult> {
    const run = await db.reconciliationRun.create({ data: { type, status: "PROCESSING" } });
    const drifts: ReconciliationResult["drifts"] = [];
    let walletsChecked = 0;
    let driftDetected = 0;
    let driftCorrected = 0;

    const BATCH_SIZE = 500;
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const batch = await db.wallet.findMany({
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: { id: true, userId: true, balanceKobo: true },
        orderBy: { id: "asc" },
      });

      for (const wallet of batch) {
        const ledgerBalance = await getLedgerBalance(wallet.id);
        if (ledgerBalance !== wallet.balanceKobo) {
          driftDetected++;
          drifts.push({ walletId: wallet.id, userId: wallet.userId, cached: wallet.balanceKobo, ledger: ledgerBalance, delta: ledgerBalance - wallet.balanceKobo });
          // Correct the cache.
          await db.wallet.update({
            where: { id: wallet.id },
            data: { balanceKobo: ledgerBalance, version: { increment: 1 } },
          });
          driftCorrected++;
          await audit({
            userId: wallet.userId,
            action: "RECONCILIATION_DRIFT_CORRECTED",
            category: "WALLET",
            severity: "WARN",
            metadata: { walletId: wallet.id, cached: wallet.balanceKobo, ledger: ledgerBalance, delta: ledgerBalance - wallet.balanceKobo },
          });
        }
      }

      walletsChecked += batch.length;
      hasMore = batch.length === BATCH_SIZE;
      cursor = batch.length > 0 ? batch[batch.length - 1].id : undefined;
    }

    await db.reconciliationRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", walletsChecked, driftDetected, driftCorrected, metadata: JSON.stringify(drifts.slice(0, 100)), completedAt: new Date() },
    });

    return { runId: run.id, walletsChecked, driftDetected, driftCorrected, drifts };
  }

  /** Reconcile a single wallet (admin tool). */
  async runOne(walletId: string) {
    const wallet = await db.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) throw new Error("Wallet not found");
    const ledgerBalance = await getLedgerBalance(wallet.id);
    const matched = ledgerBalance === wallet.balanceKobo;
    if (!matched) {
      await db.wallet.update({ where: { id: walletId }, data: { balanceKobo: ledgerBalance, version: { increment: 1 } } });
    }
    return { walletId, cached: wallet.balanceKobo, ledger: ledgerBalance, matched, corrected: !matched };
  }

  async listRuns(limit = 20) {
    return db.reconciliationRun.findMany({ orderBy: { startedAt: "desc" }, take: limit });
  }
}

export const reconciliation = new ReconciliationService();
