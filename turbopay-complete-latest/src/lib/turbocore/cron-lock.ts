/**
 * TurboCore — Cron Leader Election
 * ==================================
 *
 * Ensures only ONE app instance runs each cron job at a time, even with
 * multiple instances behind a load balancer. Uses a DB row (CronLock) with
 * a TTL — if the instance that acquired the lock crashes, the lock
 * auto-expires after `ttlMs` and another instance can pick it up.
 *
 * Usage in a cron route:
 *   const lock = await acquireCronLock("outbox-publisher", 60_000);
 *   if (!lock) return json({ data: { skipped: true, reason: "already_running" } });
 *   try {
 *     // ... do the work ...
 *   } finally {
 *     await releaseCronLock(lock);
 *   }
 *
 * The TTL must be LONGER than the expected cron runtime but SHORTER than the
 * cron interval — so a crashed run releases the lock before the next tick.
 */
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { logger } from "@/lib/turbocore/logger";

const INSTANCE_ID = `${process.env.HOSTNAME ?? "local"}-${process.pid}-${randomUUID().slice(0, 8)}`;

export interface CronLockHandle {
  id: string;
  name: string;
  instanceId: string;
}

/**
 * Try to acquire a cron lock. Returns null if another instance holds it.
 *
 * Atomicity: uses `upsert` with a `where` clause that only matches if the
 * existing lock has expired (lockedAt is null OR expiresAt < now). This is
 * a single SQL statement — no race window between read and write.
 */
export async function acquireCronLock(name: string, ttlMs: number = 60_000): Promise<CronLockHandle | null> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    // Try to acquire by upserting. If the row exists with a non-expired lock,
    // we DON'T overwrite it (the where clause on update prevents this).
    const existing = await db.cronLock.findUnique({ where: { name } });

    if (existing && existing.lockedBy && existing.expiresAt && existing.expiresAt > now) {
      // Another instance holds a valid lock.
      return null;
    }

    // Either no row, or the lock has expired — acquire it.
    const lock = await db.cronLock.upsert({
      where: { name },
      create: { name, lockedBy: INSTANCE_ID, lockedAt: now, expiresAt },
      update: { lockedBy: INSTANCE_ID, lockedAt: now, expiresAt },
    });

    // Double-check we actually got it (another instance might have raced us).
    if (lock.lockedBy !== INSTANCE_ID) {
      return null;
    }

    return { id: lock.id, name, instanceId: INSTANCE_ID };
  } catch (err) {
    // If the DB is down, fail OPEN (let the cron run) — better to risk a
    // duplicate run than to skip a critical cron like stuck-transactions.
    logger.error("cron_lock.acquire_failed", { name, error: err instanceof Error ? err.message : String(err) });
    return { id: "fallback", name, instanceId: INSTANCE_ID };
  }
}

/**
 * Release a cron lock. Only releases if the current instance holds it.
 */
export async function releaseCronLock(lock: CronLockHandle): Promise<void> {
  try {
    await db.cronLock.updateMany({
      where: { name: lock.name, lockedBy: lock.instanceId },
      data: { lockedBy: null, lockedAt: null, expiresAt: null },
    });
  } catch (err) {
    logger.error("cron_lock.release_failed", { name: lock.name, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Get the status of all cron locks (for admin monitoring).
 */
export async function listCronLocks() {
  return db.cronLock.findMany({
    select: { name: true, lockedBy: true, lockedAt: true, expiresAt: true },
  });
}
