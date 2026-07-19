/**
 * Mobile Money Disbursement API
 * ===============================
 *
 * POST /api/mobile-money/disburse — Initiate a disbursement (send money via mobile money)
 *
 * Body: { phoneNumber, amountMinor, currency, country, reference, preferredProvider? }
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { requireUser } from "@/lib/turbopay/auth";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { getMobileMoneyService } from "@/lib/turbocore/services/mobile-money";
import type { MobileMoneyProvider } from "@/lib/turbocore/providers/interfaces/mobile-money";

export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401); }

  const limited = await rateLimit(req, { key: "momo-disburse", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  let body;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { phoneNumber, amountMinor, currency, country, reference, preferredProvider } = body as {
    phoneNumber: string;
    amountMinor: number;
    currency: string;
    country: string;
    reference: string;
    preferredProvider?: MobileMoneyProvider;
  };

  if (!phoneNumber) return errorJson("phoneNumber is required", 400);
  if (!amountMinor || amountMinor <= 0) return errorJson("amountMinor must be positive", 400);
  if (!currency) return errorJson("currency is required", 400);
  if (!country) return errorJson("country is required", 400);
  if (!reference) return errorJson("reference is required", 400);

  const service = getMobileMoneyService();
  const result = await service.disburse(
    { phoneNumber, amountMinor, currency: currency as any, country, reference },
    user.id,
    preferredProvider,
  );

  if (result.success) {
    return json({ data: result.transaction });
  } else {
    return errorJson(result.error ?? "Disbursement failed", 400);
  }
}
