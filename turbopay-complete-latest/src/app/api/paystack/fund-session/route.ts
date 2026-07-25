import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { walletService } from "@/lib/turbopay/services/wallet.service";
import { ServiceError } from "@/lib/turbopay/services/types";
import { z } from "zod";

const schema = z.object({
  amountNaira: z.number().min(100, "Minimum amount is ₦100").max(500000, "Maximum amount is ₦500,000"),
});

/**
 * POST /api/paystack/fund-session
 *
 * Initializes a Paystack transaction for wallet funding.
 * Returns the authorization URL for redirect to Paystack checkout.
 */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "paystack-fund", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid request body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid amount", 422, "VALIDATION");

  try {
    const result = await walletService.fundViaPaystack(user.id, parsed.data.amountNaira);
    return json({ data: result });
  } catch (e: any) {
    if (e instanceof ServiceError) {
      return errorJson(e.message, e.status, e.code);
    }
    return errorJson(e.message || "Failed to initialize payment", 500);
  }
}
