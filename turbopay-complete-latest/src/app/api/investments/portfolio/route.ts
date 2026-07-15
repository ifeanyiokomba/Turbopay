import { requireUser } from "@/lib/turbopay/auth";
import { investments } from "@/lib/turbocore/investments";
import { errorJson, json } from "@/lib/turbopay/api";

/** GET /api/investments/portfolio — current holdings with current value. */
export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await investments.getPortfolio(user.id) });
}
