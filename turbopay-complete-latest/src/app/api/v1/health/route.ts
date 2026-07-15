import { db } from "@/lib/db";
import { json } from "@/lib/turbopay/api";

/**
 * GET /api/v1/health — Versioned health check endpoint.
 *
 * Returns comprehensive health status with per-component checks.
 * This is the v1 version — stable API contract for clients.
 */
export async function GET() {
  const checks: Record<string, { status: string; latencyMs?: number }> = {};

  // Database
  const dbStart = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
  } catch {
    checks.database = { status: "error" };
  }

  // Memory
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  checks.memory = {
    status: heapUsedMB < 512 ? "ok" : "warning",
    latencyMs: heapUsedMB,
  };

  // Uptime
  checks.uptime = {
    status: "ok",
    latencyMs: process.uptime ? Math.floor(process.uptime()) : 0,
  };

  const healthy = checks.database?.status === "ok";

  return json({
    status: healthy ? "ok" : "degraded",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    checks,
  }, healthy ? 200 : 503);
}
