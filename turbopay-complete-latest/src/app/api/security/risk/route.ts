import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { computeRiskScore } from "@/lib/turbocore/security";

/** GET /api/security/risk — current risk score + contributing factors. */
export async function GET(req: Request) {
  const limited = await rateLimit(req, { key: "security-risk", limit: 10, windowMs: 60_000, scope: "user" });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const risk = await computeRiskScore(user.id, { isNewDevice: false });
  return json({ data: risk });
}
