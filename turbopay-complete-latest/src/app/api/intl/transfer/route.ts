import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { intlTransferService } from "@/lib/turbopay/services/intl-transfer.service";
import { ServiceError } from "@/lib/turbopay/services/types";

/**
 * GET /api/intl/transfer?id=xxx — get detailed transfer info with state history.
 */
export async function GET(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { searchParams } = new URL(req.url);

  try {
    const result = await intlTransferService.detail(user.id, {
      id: searchParams.get("id") ?? undefined,
      reference: searchParams.get("reference") ?? undefined,
    });
    return json({ data: result });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message || "Failed to load transfer", 500);
  }
}
