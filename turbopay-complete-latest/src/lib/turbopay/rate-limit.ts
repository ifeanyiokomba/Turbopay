import { errorJson } from "@/lib/turbopay/api";
import { readIp } from "@/lib/turbopay/auth";
import { logger } from "@/lib/turbocore/logger";
import * as crypto from "node:crypto";

/**
 * RATE LIMITER — sliding window.
 *
 * Backend: Redis (if REDIS_URL is set) or in-memory Map (fallback).
 * The function signature (rateLimit(req, opts)) is identical for both
 * backends — only the storage changes.
 *
 * In a multi-instance deployment (Vercel, Docker replicas), each instance
 * has an independent in-memory counter — a user can make limit × N requests
 * per window by hitting N instances. Redis solves this by sharing the
 * counter across all instances.
 *
 * Usage in a route:
 *   const limited = await rateLimit(req, { key: "login", limit: 10, windowMs: 60_000 });
 *   if (limited) return limited; // 429 response
 */

export interface RateLimitOptions {
  /** Logical bucket name (e.g. "login", "transfer"). */
  key: string;
  /** Max requests allowed in the window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Scope: per-IP (default) or per-user (requires authenticated request). */
  scope?: "ip" | "user";
  /** Optional user id (for scope="user"). */
  userId?: string;
  /** Optional identifier (e.g. normalised email) for an UNAUTHENTICATED per-actor
   *  rate limit. Used at the login endpoint where we want to throttle attempts
   *  against a single known email regardless of source IP — defeating distributed
   *  botnet brute-force. Takes precedence over `scope`/`userId` when set. */
  identifier?: string;
}

// ─── In-memory backend ────────────────────────────────────────

interface Bucket {
  hits: number[];
  expiresAt: number;
}

const memStore = new Map<string, Bucket>();

// Hard cap on the number of buckets. If a burst of unique IPs exceeds this
// threshold, the oldest (most likely expired) buckets are evicted first.
// At ~100 bytes per bucket entry this caps memory at ~2.5 MB.
const MAX_BUCKETS = 25_000;

function evictOldestBuckets(): void {
  if (memStore.size <= MAX_BUCKETS) return;
  const now = Date.now();
  // Collect expired entries first, then oldest entries if still over cap.
  const toDelete: string[] = [];
  for (const [k, v] of memStore) {
    if (v.expiresAt < now) toDelete.push(k);
  }
  // If still over cap after removing expired, drop oldest buckets.
  if (toDelete.length < memStore.size - MAX_BUCKETS) {
    const entries = [...memStore.entries()]
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const excess = memStore.size - MAX_BUCKETS;
    for (let i = 0; i < excess && i < entries.length; i++) {
      toDelete.push(entries[i][0]);
    }
  }
  for (const k of toDelete) memStore.delete(k);
}

// Periodically evict expired buckets to avoid unbounded growth.
// Skip in test environments to avoid keeping the process alive.
if (process.env.NODE_ENV !== "test" && process.env.VITEST === undefined) {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of memStore) {
      if (v.expiresAt < now) memStore.delete(k);
    }
    evictOldestBuckets();
  }, 60_000).unref?.();
}

async function memRateLimit(bucketKey: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const now = Date.now();
  const windowStart = now - windowMs;

  let bucket = memStore.get(bucketKey);
  if (!bucket || bucket.expiresAt < now) {
    bucket = { hits: [], expiresAt: now + windowMs };
    memStore.set(bucketKey, bucket);
  }
  bucket.hits = bucket.hits.filter((t) => t > windowStart);

  if (bucket.hits.length >= limit) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000)) };
  }
  bucket.hits.push(now);
  return { allowed: true, retryAfterSec: 0 };
}

// ─── Redis backend ────────────────────────────────────────────

let redisClient: import("ioredis").default | null = null;
let redisWarned = false;

async function getRedis() {
  if (redisClient) return redisClient;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  // Lazy-load ioredis only when Redis is configured.
  const IORedis = (await import("ioredis")).default;
  redisClient = new IORedis(redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
  redisClient.on("error", (err) => {
    logger.error("rate-limit.redis_error", { error: err.message });
  });
  if (!redisWarned) {
    logger.info("rate-limit.redis_connected");
    redisWarned = true;
  }
  return redisClient;
}

/** Shared Redis client — reuse in health checks to avoid opening new connections per request. */
export { getRedis as getSharedRedis };

async function redisRateLimit(bucketKey: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const redis = await getRedis();
  if (!redis) return memRateLimit(bucketKey, limit, windowMs);

  const now = Date.now();
  const windowStart = now - windowMs;
  const key = `ratelimit:${bucketKey}`;

  // Sliding window via sorted set: remove old entries, count current, add new.
  const pipe = redis.multi();
  pipe.zremrangebyscore(key, 0, windowStart);
  pipe.zcard(key);
  pipe.zadd(key, now, `${now}:${crypto.randomBytes(4).toString("hex")}`);
  pipe.pexpire(key, windowMs);
  const results = await pipe.exec();
  const count = results ? Number(results[1][1]) : 0;

  if (count >= limit) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(windowMs / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

// ─── Public API ───────────────────────────────────────────────

let startupWarned = false;

export async function rateLimit(
  req: Request,
  opts: RateLimitOptions
): Promise<null | ReturnType<typeof errorJson>> {
  let scopeKey: string;
  if (opts.identifier) {
    // Per-actor limit keyed on a caller-supplied identifier (e.g. normalised
    // email at login). Defends against distributed-IP brute-force on a single
    // known account.
    scopeKey = `id:${opts.identifier}`;
  } else if (opts.scope === "user" && opts.userId) {
    scopeKey = `u:${opts.userId}`;
  } else {
    scopeKey = `ip:${readIp(req.headers) ?? "anon"}`;
  }
  const bucketKey = `${opts.key}:${scopeKey}`;

  // Use Redis if configured; fall back to in-memory.
  const redis = await getRedis();
  if (!redis && !startupWarned) {
    if (process.env.NODE_ENV === "production") {
      logger.error("rate_limit.no_redis", { message: "REDIS_URL not set in production — rate limits are per-instance and bypassable. This is a security risk." });
    } else {
      logger.warn("rate_limit.no_redis", { message: "REDIS_URL not set — using in-memory fallback. NOT safe for multi-instance deployments." });
    }
    startupWarned = true;
  }

  const result = redis
    ? await redisRateLimit(bucketKey, opts.limit, opts.windowMs)
    : await memRateLimit(bucketKey, opts.limit, opts.windowMs);

  if (!result.allowed) {
    // RFC 6585: a 429 MUST include Retry-After so clients can back off correctly.
    return errorJson(
      "Too many requests. Please slow down and try again shortly.",
      429,
      "RATE_LIMITED",
      undefined,
      { "Retry-After": String(result.retryAfterSec) }
    ) as ReturnType<typeof errorJson>;
  }

  return null;
}
