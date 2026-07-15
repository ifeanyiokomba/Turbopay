/**
 * TurboPay — Read Replica Database Client
 * ========================================
 *
 * A separate Prisma client configured to use a read replica for analytics
 * and reporting queries. This offloads expensive read operations from the
 * primary database, improving performance for both transactional and
 * analytical workloads.
 *
 * Usage:
 *   import { dbRead } from "@/lib/db-read";
 *   const analytics = await dbRead.transaction.findMany({ ... });
 *
 * IMPORTANT: Never use dbRead for:
 *   - Financial transactions
 *   - Wallet balance updates
 *   - Payment processing
 *   - Any write operation
 *
 * The read replica may lag behind the primary by a few seconds (replication
 * lag). This is acceptable for analytics but not for real-time financial data.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrismaRead = globalThis as unknown as {
  prismaRead: PrismaClient | undefined;
};

function createReadClient(): PrismaClient {
  const replicaUrl = process.env.DATABASE_URL_REPLICA;

  if (!replicaUrl) {
    // No replica configured — fall back to primary (single-instance mode)
    console.warn("[db-read] DATABASE_URL_REPLICA not set. Read queries will use the primary database.");
    return new PrismaClient({
      log: ["warn", "error"],
    });
  }

  return new PrismaClient({
    datasources: {
      db: {
        url: replicaUrl,
      },
    },
    log: ["warn", "error"],
  });
}

/**
 * Read replica Prisma client. Use for analytics, reporting, and historical
 * queries. Never use for financial transactions or writes.
 *
 * Falls back to the primary database if DATABASE_URL_REPLICA is not set.
 */
export const dbRead =
  globalForPrismaRead.prismaRead ?? createReadClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrismaRead.prismaRead = dbRead;
}

/**
 * Check if a read replica is configured.
 * Useful for conditional logic (e.g., skip replica for small queries).
 */
export function hasReadReplica(): boolean {
  return !!process.env.DATABASE_URL_REPLICA;
}
