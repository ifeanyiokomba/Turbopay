/**
 * TurboCore — Distributed Cache Layer
 * ======================================
 *
 * A cache abstraction that uses Redis when available (for multi-instance
 * deployments) and falls back to an in-memory LRU cache (for dev / single-
 * instance). All callers use the same `cache.get/set/del` API — no code
 * changes needed when switching from dev to production.
 *
 * Why this matters for load balancing:
 *  - In a multi-instance deployment, each instance has its own in-memory
 *    cache, so a config change on instance A isn't visible to instance B
 *    until the TTL expires. With Redis, the cache is SHARED — all instances
 *    see the same data instantly.
 *  - Rate limits MUST be distributed — otherwise 3 instances = 3× the brute-
 *    force budget. With Redis, the counter is shared.
 *  - Circuit breaker state MUST be shared — otherwise 3 instances = 3× the
 *    failure budget before the breaker opens.
 *
 * Set REDIS_URL in production to enable Redis. Without it, the app runs in
 * single-instance mode (in-memory fallback).
 */

// ─── In-memory fallback (LRU with TTL) ──────────────────────────

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, MemoryEntry>();
  private maxSize = 1000;

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    // LRU: move to end (most-recently-used).
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    // Evict oldest if at capacity.
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async incr(key: string, ttlMs: number): Promise<number> {
    const current = parseInt((await this.get(key)) ?? "0", 10);
    const next = current + 1;
    await this.set(key, String(next), ttlMs);
    return next;
  }

  async expire(key: string, ttlMs: number): Promise<void> {
    const value = await this.get(key);
    if (value !== null) await this.set(key, value, ttlMs);
  }
}

// ─── Redis client (lazy-loaded) ─────────────────────────────────

import { logger } from "@/lib/turbocore/logger";

let redisClient: any = null;
let redisInitAttempted = false;

async function getRedisClient(): Promise<any | null> {
  if (redisInitAttempted) return redisClient;
  redisInitAttempted = true;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    // Dynamic import — avoids a hard dependency on ioredis for dev.
    const { Redis } = await import("ioredis");
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 100, 1000),
    });
    redisClient.on("error", (err: any) => {
      logger.error("redis.connection_error", { error: err.message });
    });
    logger.info("redis.connected");
    return redisClient;
  } catch (err: any) {
    logger.warn("redis.connection_failed", { error: err.message, fallback: "in-memory" });
    return null;
  }
}

// ─── Unified cache API ──────────────────────────────────────────

class DistributedCache {
  private memory = new MemoryCache();
  private isRedisAvailable = false;

  constructor() {
    // Check Redis availability on first use (lazy).
    getRedisClient().then((client) => {
      this.isRedisAvailable = !!client;
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const client = await getRedisClient();
    if (client) {
      const raw = await client.get(key);
      if (!raw) return null;
      try { return JSON.parse(raw) as T; } catch { return null; }
    }
    const mem = await this.memory.get(key);
    if (!mem) return null;
    try { return JSON.parse(mem) as T; } catch { return null; }
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    const serialized = JSON.stringify(value);
    const client = await getRedisClient();
    if (client) {
      // PX = milliseconds (Redis SETEX uses seconds; PSETEX uses ms).
      await client.set(key, serialized, "PX", ttlMs);
      return;
    }
    await this.memory.set(key, serialized, ttlMs);
  }

  async del(key: string): Promise<void> {
    const client = await getRedisClient();
    if (client) {
      await client.del(key);
      return;
    }
    await this.memory.del(key);
  }

  /**
   * Atomic counter — used by the rate limiter. Returns the new value after
   * increment. The key auto-expires after ttlMs.
   */
  async incr(key: string, ttlMs: number): Promise<number> {
    const client = await getRedisClient();
    if (client) {
      const multi = client.multi();
      multi.incr(key);
      multi.pexpire(key, ttlMs);
      const results = await multi.exec();
      return results[0][1] as number;
    }
    return this.memory.incr(key, ttlMs);
  }

  /** Check if Redis is connected (for health checks). */
  isDistributed(): boolean {
    return this.isRedisAvailable;
  }
}

export const cache = new DistributedCache();

// ─── Helpers for common patterns ────────────────────────────────

/**
 * Cache-aside helper: get from cache, or compute + cache the result.
 * Usage:
 *   const config = await cacheAside("provider-config:monnify", 60_000, () => loadFromDb());
 */
export async function cacheAside<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  const cached = await cache.get<T>(key);
  if (cached !== null) return cached;
  const fresh = await compute();
  await cache.set(key, fresh, ttlMs);
  return fresh;
}
