import { db } from "@/lib/db";
import { json } from "@/lib/turbopay/api";

/**
 * PUBLIC STATUS — lightweight uptime/availability snapshot.
 *
 * Intentionally PUBLIC (no auth) for embedding on a status page, in an
 * external status-monitor (UptimeRobot, BetterUptime), or in marketing
 * copy. Returns ONLY operational status — no credentials, no internal URLs,
 * no counts, no PII. For a detailed, RBAC-gated health view, use
 * /api/admin/system/health instead.
 *
 * Response:
 *   {
 *     "status": "operational" | "degraded" | "down",
 *     "timestamp": ISO8601,
 *     "services": { "database": "up" | "down" }
 *   }
 *
 * The database probe is wrapped in a 2-second timeout via Promise.race
 * so a hung DB doesn't stall the response (and the status monitor).
 */
export async function GET() {
  let database: "up" | "down" = "down";
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("db-timeout")), 2000)
    );
    await Promise.race([db.user.count({ take: 1 }), timeout]);
    database = "up";
  } catch {
    database = "down";
  }

  const status: "operational" | "degraded" | "down" =
    database === "down" ? "down" : "operational";

  return json({
    data: {
      status,
      timestamp: new Date().toISOString(),
      services: { database },
    },
  });
}
