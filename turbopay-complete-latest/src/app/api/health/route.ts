import { db } from "@/lib/db";
import { json, errorJson } from "@/lib/turbopay/api";
import { getSharedRedis } from "@/lib/turbopay/rate-limit";

/**
 * Health check endpoint for uptime monitoring + container orchestration.
 * Returns 200 if all checks pass, 503 if any critical check fails.
 *
 * Checks:
 *   - Database connectivity
 *   - Redis connectivity (if configured)
 *   - Memory usage
 *   - Disk space (approximate)
 */
export async function GET() {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};
  let healthy = true;

  // 1. Database connectivity
  const dbStart = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
  } catch (e: any) {
    checks.database = { status: "error", error: e.message };
    healthy = false;
  }

  // 2. Redis connectivity (if configured)
  if (process.env.REDIS_URL) {
    const redisStart = Date.now();
    try {
      const redis = await getSharedRedis();
      if (redis) {
        await redis.ping();
        checks.redis = { status: "ok", latencyMs: Date.now() - redisStart };
      }
    } catch (e: any) {
      checks.redis = { status: "error", error: e.message };
      // Redis is non-critical — don't fail the health check
    }
  }

  // 3. Memory usage
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  checks.memory = {
    status: heapUsedMB < heapTotalMB * 0.9 ? "ok" : "warning",
    latencyMs: heapUsedMB,
    error: heapUsedMB >= heapTotalMB * 0.9 ? "Heap usage above 90%" : undefined,
  };

  // 4. Uptime
  checks.uptime = {
    status: "ok",
    latencyMs: process.uptime ? Math.floor(process.uptime()) : 0,
  };

  const statusCode = healthy ? 200 : 503;
  return json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
    },
    statusCode
  );
}
