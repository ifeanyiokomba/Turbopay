import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { intlTransferService } from "@/lib/turbopay/services/intl-transfer.service";
import { ServiceError } from "@/lib/turbopay/services/types";

/**
 * GET /api/intl/history — list international transfer history for the user.
 */
export async function GET(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { searchParams } = new URL(req.url);

  try {
    const result = await intlTransferService.history(user.id, {
      status: searchParams.get("status") ?? undefined,
      limit: Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100),
      cursor: searchParams.get("cursor") ?? undefined,
    });
    return json({ data: result.items, nextCursor: result.nextCursor });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message || "Failed to load history", 500);
  }
}
