/**
 * Mobile Money Balance API
 * ==========================
 *
 * GET /api/mobile-money/balance — Get health status of all initialized mobile money providers
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { requireUser } from "@/lib/turbopay/auth";
import { getMobileMoneyService } from "@/lib/turbocore/services/mobile-money";

export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401); }

  const service = getMobileMoneyService();
  const health = await service.getProviderHealth();

  return json({ data: health });
}
