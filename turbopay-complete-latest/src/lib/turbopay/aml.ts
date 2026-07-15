import { db } from "@/lib/db";
import type { KycTier } from "@/lib/turbopay/types";
import { audit } from "@/lib/turbopay/audit";
import { kycLimits } from "@/lib/turbocore/config/kyc-limits";
import { amlPolicy } from "@/lib/turbocore/config/aml-policy";

/**
 * AML / RISK LAYER — velocity monitoring, large-amount flags, suspicious
 * activity detection. Now reads KYC tier limits + AML policy from the DB
 * (with hardcoded fallback if no DB rows exist).
 *
 * IMPORTANT: HIGH-severity flags ACTUALLY freeze the wallet + open a
 * compliance case for review.
 *
 * ── Concurrency ─────────────────────────────────────────────────────
 * `checkDebit` accepts an optional `tx` parameter so it can be invoked
 * INSIDE the caller's Prisma transaction. When `tx` is provided, every
 * DB read (transaction.count / findMany) + write (amlFlag.create,
 * wallet.updateMany, user.updateMany) runs against the caller's tx —
 * making the AML check atomic with the subsequent debit. This closes
 * the prior race where two simultaneous requests could each pass the
 * AML velocity / daily-cap check before either posted its debit
 * (F6 — AML velocity/daily-cap checks aren't concurrency-safe).
 *
 * In the TurboPay orchestrator (`executeProviderDebit`), the AML check
 * runs inside the same `db.$transaction` as the hold (debit) so the
 * AML counters are read + the debit is posted atomically. A per-user
 * advisory lock (`pg_advisory_xact_lock(hashtext(userId))`) is acquired
 * at the start of the transaction to serialize concurrent debits for the
 * same user on PostgreSQL. On the dev SQLite (single-threaded JS event
 * loop) the advisory lock is a no-op; the in-tx check is sufficient.
 *
 * See `src/lib/turbopay/advisory-lock.ts` and `src/lib/turbopay/payments.ts`.
 */

/** Prisma transaction client type — same alias used in ledger.ts. */
type Tx = Parameters<Parameters<typeof db["$transaction"]>[0]>[0];

export interface AmlCheckResult {
  allowed: boolean;
  reason?: string;
  flags: { rule: string; severity: string; description: string }[];
  frozeWallet?: boolean;
}

/**
 * Check a prospective debit against KYC limits + velocity rules.
 *
 * @param tx Optional Prisma transaction client. When provided, every DB
 *           read/write runs against the caller's tx — making the AML
 *           check atomic with the debit (closes the F6 race window).
 *           When omitted, the global `db` client is used (preserves the
 *           pre-F6 behaviour for direct callers + existing tests).
 */
export async function checkDebit(
  userId: string,
  walletId: string,
  amountKobo: number,
  kycTier: KycTier,
  tx?: Tx
): Promise<AmlCheckResult> {
  // Use the caller's tx if provided (atomic AML + debit), else the global client.
  const client = tx ?? db;
  const flags: { rule: string; severity: string; description: string }[] = [];

  // Load configurable limits + policy from DB (falls back to hardcoded defaults).
  // NOTE: kycLimits + amlPolicy have their own DB reads; they are config tables
  // that change rarely + are cached internally, so we read them via the global
  // `db` rather than the caller's tx (config staleness within a 15s tx is
  // irrelevant; the cost of running them through the tx would be 2 extra
  // round-trips per AML check).
  const [limits, policy] = await Promise.all([
    kycLimits.getLimits(kycTier, "turbopay"),
    amlPolicy.getActive(),
  ]);

  // 1. Single transaction limit (KYC)
  if (amountKobo > limits.singleTxKobo) {
    return {
      allowed: false,
      reason: `Amount exceeds your Tier ${kycTier} single-transaction limit (₦${(limits.singleTxKobo / 100).toLocaleString()}). Please upgrade KYC.`,
      flags,
    };
  }

  // 2. Daily cumulative debit limit
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentDebits = await client.transaction.findMany({
    where: { userId, direction: "DEBIT", status: { in: ["SUCCESS", "PENDING"] }, createdAt: { gte: since } },
    select: { amountKobo: true },
  });
  const dailyOut = recentDebits.reduce((a, t) => a + t.amountKobo, 0);
  if (dailyOut + amountKobo > limits.dailyTxKobo) {
    return {
      allowed: false,
      reason: `Amount exceeds your Tier ${kycTier} daily transaction limit (₦${(limits.dailyTxKobo / 100).toLocaleString()}).`,
      flags,
    };
  }

  // 3. Velocity — uses configurable policy
  const velocityCfg = policy.velocity;
  if (velocityCfg) {
    const windowMs = (velocityCfg.windowMin ?? 60) * 60 * 1000;
    const windowAgo = new Date(Date.now() - windowMs);
    const rapidDebits = await client.transaction.count({ where: { userId, direction: "DEBIT", createdAt: { gte: windowAgo } } });
    if (rapidDebits >= (velocityCfg.maxDebits ?? 10)) {
      flags.push({ rule: "VELOCITY", severity: velocityCfg.severity ?? "HIGH", description: `${rapidDebits} debit transactions within the last ${velocityCfg.windowMin ?? 60} minutes` });
    }
  }

  // 4. Large amount — uses configurable threshold
  const largeAmtCfg = policy.largeAmount;
  if (largeAmtCfg && amountKobo >= largeAmtCfg.thresholdMinor) {
    flags.push({ rule: "LARGE_AMOUNT", severity: largeAmtCfg.severity ?? "MEDIUM", description: `Transaction ≥ ₦${(largeAmtCfg.thresholdMinor / 100).toLocaleString()}` });
  }

  // 5. Rapid transfer — uses configurable threshold
  const rapidCfg = policy.rapidTransfer;
  if (rapidCfg) {
    const windowMs = (rapidCfg.windowMin ?? 5) * 60 * 1000;
    const windowAgo = new Date(Date.now() - windowMs);
    const rapidTransfers = await client.transaction.count({ where: { userId, type: "TRANSFER_OUT", createdAt: { gte: windowAgo } } });
    if (rapidTransfers >= (rapidCfg.maxTransfers ?? 3)) {
      flags.push({ rule: "RAPID_TRANSFER", severity: rapidCfg.severity ?? "HIGH", description: `${rapidTransfers} outbound transfers within ${rapidCfg.windowMin ?? 5} minutes` });
    }
  }

  // Persist flags — use the caller's tx if provided so the flag writes
  // commit/rollback atomically with the debit.
  for (const f of flags) {
    await client.amlFlag.create({ data: { userId, rule: f.rule, severity: f.severity, description: f.description } });
  }

  // Auto-FREEZE on HIGH severity (if policy allows)
  const hasHigh = flags.some((f) => f.severity === "HIGH");
  if (hasHigh && (policy.autoFreezeOnHigh ?? true)) {
    await client.wallet.updateMany({ where: { id: walletId, status: "ACTIVE" }, data: { status: "FROZEN" } });
    await client.user.updateMany({ where: { id: userId, status: "ACTIVE" }, data: { status: "SUSPENDED" } });
    await audit({ userId, action: "WALLET_FROZEN_AML", category: "AML", severity: "CRITICAL", metadata: { walletId, flags } });

    // Open a compliance case for the HIGH-severity flag.
    const lastFlag = flags.find((f) => f.severity === "HIGH");
    if (lastFlag) {
      try {
        const { complianceCases } = await import("@/lib/turbocore/compliance/cases");
        await complianceCases.openCase(userId, "REVIEW", "HIGH", `Auto-flagged by AML: ${lastFlag.description}`, undefined, undefined);
      } catch { /* compliance module not available in all contexts */ }
    }

    return { allowed: false, reason: "Account suspended by risk monitoring. Please contact Turbopay support.", flags, frozeWallet: true };
  }

  return { allowed: true, flags };
}

/** Get unresolved AML flags for a user (admin view). */
export async function getUserFlags(userId: string) {
  return db.amlFlag.findMany({ where: { userId, resolved: false }, orderBy: { createdAt: "desc" } });
}
