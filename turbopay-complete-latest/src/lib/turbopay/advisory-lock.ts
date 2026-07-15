import { db } from "@/lib/db";

/**
 * PER-USER ADVISORY LOCK for serializing concurrent debits.
 *
 * Uses `pg_advisory_xact_lock(hashtext(userId))` which:
 *   - Blocks until the lock is acquired (or throws on timeout)
 *   - Is automatically released when the Prisma transaction commits/rolls back
 *   - Serializes all $transaction calls for the same userId
 *
 * This closes the F6 race condition where two concurrent PostgreSQL transactions
 * could each read pre-debit AML counters, both pass checks, then both commit —
 * a classic read-skew. The advisory lock ensures only one debit transaction per
 * user can proceed at a time.
 *
 * On SQLite (dev), this is a no-op — SQLite's single-threaded JS event loop
 * already prevents the concurrent-read-skew race.
 */

type Tx = Parameters<Parameters<typeof db["$transaction"]>[0]>[0];

export async function acquireUserDebitLock(tx: Tx, userId: string): Promise<void> {
  // SQLite has no advisory locks — skip in dev
  if (process.env.DATABASE_URL?.startsWith("file:")) return;

  // PostgreSQL advisory lock — blocks until acquired, auto-releases on tx end
  await tx.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    userId
  );
}
