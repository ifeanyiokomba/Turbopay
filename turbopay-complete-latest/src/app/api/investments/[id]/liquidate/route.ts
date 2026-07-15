import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { investments } from "@/lib/turbocore/investments";

/**
 * POST /api/investments/[id]/liquidate — liquidate an investment position.
 *
 * Idempotent: only ACTIVE investments can be liquidated. Returns the
 * principal + expected return credited to the user's wallet.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await rateLimit(req, { key: "investments", limit: 5, windowMs: 60_000, scope: "user" });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { id } = await params;

  try {
    const result = await investments.liquidate(user.id, id);
    return json({ data: result });
  } catch (e: any) {
    return errorJson(e.message ?? "Liquidation failed", 400, "LIQUIDATION_FAILED");
  }
}
