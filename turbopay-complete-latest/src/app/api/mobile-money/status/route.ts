/**
 * Mobile Money Status API
 * =========================
 *
 * GET /api/mobile-money/status?id=<transactionId> — Check transaction status
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { requireUser } from "@/lib/turbopay/auth";
import { getMobileMoneyService } from "@/lib/turbocore/services/mobile-money";

export async function GET(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401); }

  const url = new URL(req.url);
  const transactionId = url.searchParams.get("id");
  if (!transactionId) return errorJson("id query param is required", 400);

  const service = getMobileMoneyService();
  const result = await service.checkStatus(transactionId);

  if (result.success) {
    return json({ data: { transactionId, status: result.status } });
  } else {
    return errorJson(result.error ?? "Status check failed", 400);
  }
}
