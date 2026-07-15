import { requireAdmin } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { analytics } from "@/lib/turbocore/analytics";

/**
 * GET /api/admin/analytics — comprehensive dashboard analytics.
 *
 * Query params:
 *   - from: ISO date string (default: 30 days ago)
 *   - to: ISO date string (default: now)
 *   - section: specific metric section (optional)
 */
export async function GET(req: Request) {
  let admin;
  try { admin = await requireAdmin(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { searchParams } = new URL(req.url);
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : new Date();
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const section = searchParams.get("section");

  const range = { from, to };

  try {
    if (section === "user-growth") {
      const granularity = (searchParams.get("granularity") ?? "day") as "day" | "week" | "month";
      return json({ data: await analytics.userGrowth(range, granularity) });
    }
    if (section === "transaction-volume") {
      const granularity = (searchParams.get("granularity") ?? "day") as "day" | "week" | "month";
      return json({ data: await analytics.transactionVolume(range, granularity) });
    }
    if (section === "revenue") {
      return json({ data: await analytics.revenueSummary(range) });
    }
    if (section === "wallets") {
      return json({ data: await analytics.walletMetrics() });
    }
    if (section === "providers") {
      return json({ data: await analytics.providerPerformance(range) });
    }
    if (section === "kyc") {
      return json({ data: await analytics.kycCompletionRates() });
    }
    if (section === "support") {
      return json({ data: await analytics.supportTrends(range) });
    }
    if (section === "aml") {
      return json({ data: await analytics.amlSummary(range) });
    }

    // Default: full dashboard summary
    return json({ data: await analytics.dashboardSummary(range) });
  } catch (e: any) {
    return errorJson(e.message ?? "Analytics query failed", 500);
  }
}
