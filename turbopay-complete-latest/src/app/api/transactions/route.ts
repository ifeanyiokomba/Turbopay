import { requireUser } from "@/lib/turbopay/auth";
import { transactionService } from "@/lib/turbopay/services/transaction.service";
import { ServiceError } from "@/lib/turbopay/services/types";
import { errorJson, json } from "@/lib/turbopay/api";
import { sanitizeString } from "@/lib/turbopay/sanitize";

export async function GET(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { searchParams } = new URL(req.url);

  // Sanitize the free-text search query.
  const rawQ = searchParams.get("q")?.trim();
  const q = rawQ ? sanitizeString(rawQ) : undefined;

  try {
    const result = await transactionService.list({
      userId: user.id,
      type: searchParams.get("type") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      direction: searchParams.get("direction") ?? undefined,
      q,
      limit: Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200),
      offset: Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0),
    });
    return json({ data: result });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message || "Failed to load transactions", 500);
  }
}
