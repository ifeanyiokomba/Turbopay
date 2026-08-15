/**
 * TurboCore — Stuck Transaction Detector
 * ========================================
 *
 * Detects transactions stuck in PENDING, PROCESSING, or TIMEOUT states
 * beyond configurable thresholds. Flags them for reconciliation review.
 *
 * Thresholds are configurable per operation type and provider:
 *   - walletFunding: PENDING > 15 minutes → candidate
 *   - localTransfer: PENDING > 10 minutes → candidate
 *   - billPayment: PENDING > 20 minutes → candidate
 *
 * The detector does NOT automatically fail stuck transactions.
 * It flags them for operator review + reconciliation.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/turbocore/logger";

// ─── Types ────────────────────────────────────────────────────

export interface StuckTransaction {
  id: string;
  reference: string;
  userId: string;
  type: string;
  status: string;
  state: string | null;
  provider: string | null;
  providerRef: string | null;
  amountKobo: number;
  createdAt: Date;
  updatedAt: Date;
  stuckDurationMinutes: number;
  thresholdMinutes: number;
}

export interface StuckDetectionResult {
  detectedAt: Date;
  stuckTransactions: StuckTransaction[];
  totalChecked: number;
  stuckCount: number;
  byType: Record<string, number>;
  byProvider: Record<string, number>;
}

// ─── Default Thresholds (minutes) ─────────────────────────────

const DEFAULT_THRESHOLDS: Record<string, number> = {
  FUNDING: 15,
  TRANSFER_OUT: 10,
  BILL_ELECTRICITY: 20,
  BILL_UTILITY: 20,
  AIRTIME: 15,
  DATA: 15,
  INTL_TRANSFER: 30,
  default: 15,
};

// ─── Detector ─────────────────────────────────────────────────

class StuckTransactionDetector {
  /**
   * Detect stuck transactions based on configurable thresholds.
   */
  async detect(
    thresholds: Partial<Record<string, number>> = {}
  ): Promise<StuckDetectionResult> {
    const mergedThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    const now = new Date();

    // Find transactions in PENDING or PROCESSING state
    const pendingTx = await db.transaction.findMany({
      where: {
        status: { in: ["PENDING", "PROCESSING"] },
        createdAt: {
          gte: new Date(now.getTime() - 24 * 60 * 60 * 1000), // Last 24h only
        },
      },
      select: {
        id: true,
        reference: true,
        userId: true,
        type: true,
        status: true,
        state: true,
        provider: true,
        providerRef: true,
        amountKobo: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const stuckTransactions: StuckTransaction[] = [];
    const byType: Record<string, number> = {};
    const byProvider: Record<string, number> = {};

    for (const tx of pendingTx) {
      const thresholdMinutes: number = mergedThresholds[tx.type] ?? mergedThresholds.default ?? 15;
      const stuckDurationMinutes = (now.getTime() - tx.createdAt.getTime()) / (60 * 1000);

      if (stuckDurationMinutes > thresholdMinutes) {
        stuckTransactions.push({
          ...tx,
          stuckDurationMinutes: Math.round(stuckDurationMinutes),
          thresholdMinutes: thresholdMinutes,
        });

        byType[tx.type] = (byType[tx.type] ?? 0) + 1;
        if (tx.provider) {
          byProvider[tx.provider] = (byProvider[tx.provider] ?? 0) + 1;
        }
      }
    }

    logger.info("stuck_transaction_detection.completed", {
      totalChecked: pendingTx.length,
      stuckCount: stuckTransactions.length,
      byType,
      byProvider,
    });

    return {
      detectedAt: now,
      stuckTransactions,
      totalChecked: pendingTx.length,
      stuckCount: stuckTransactions.length,
      byType,
      byProvider,
    };
  }

  /**
   * Get stuck transactions for a specific provider.
   */
  async detectForProvider(
    providerName: string,
    thresholds: Partial<Record<string, number>> = {}
  ): Promise<StuckTransaction[]> {
    const result = await this.detect(thresholds);
    return result.stuckTransactions.filter((tx) => tx.provider === providerName);
  }

  /**
   * Get a summary of stuck transaction health for the dashboard.
   */
  async getHealthSummary(): Promise<{
    totalPending: number;
    totalStuck: number;
    oldestStuckMinutes: number | null;
    stuckByProvider: Record<string, number>;
    thresholdBreaches: number;
  }> {
    const now = new Date();
    const pendingTx = await db.transaction.findMany({
      where: {
        status: { in: ["PENDING", "PROCESSING"] },
        createdAt: {
          gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        },
      },
      select: {
        type: true,
        provider: true,
        createdAt: true,
      },
    });

    let totalStuck = 0;
    let oldestStuckMinutes: number | null = null;
    const stuckByProvider: Record<string, number> = {};
    let thresholdBreaches = 0;

    for (const tx of pendingTx) {
      const thresholdMinutes = DEFAULT_THRESHOLDS[tx.type] ?? DEFAULT_THRESHOLDS.default;
      const stuckDurationMinutes = (now.getTime() - tx.createdAt.getTime()) / (60 * 1000);

      if (stuckDurationMinutes > thresholdMinutes) {
        totalStuck++;
        thresholdBreaches++;
        if (tx.provider) {
          stuckByProvider[tx.provider] = (stuckByProvider[tx.provider] ?? 0) + 1;
        }
        if (!oldestStuckMinutes || stuckDurationMinutes > oldestStuckMinutes) {
          oldestStuckMinutes = Math.round(stuckDurationMinutes);
        }
      }
    }

    return {
      totalPending: pendingTx.length,
      totalStuck,
      oldestStuckMinutes,
      stuckByProvider,
      thresholdBreaches,
    };
  }
}

export const stuckTransactionDetector = new StuckTransactionDetector();
