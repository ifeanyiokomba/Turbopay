/**
 * Mobile Money Providers API
 * ===========================
 *
 * GET /api/mobile-money/providers?country=NG — List available mobile money providers for a country
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { requireUser } from "@/lib/turbopay/auth";
import { getMobileMoneyService } from "@/lib/turbocore/services/mobile-money";

export async function GET(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401); }

  const url = new URL(req.url);
  const country = url.searchParams.get("country") ?? user.country ?? "NG";

  const service = getMobileMoneyService();
  const providers = service.getAvailableProviders(country);

  return json({ data: { country, providers } });
}
