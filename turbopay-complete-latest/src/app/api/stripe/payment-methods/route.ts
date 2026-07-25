import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { stripeService } from "@/lib/turbopay/services/stripe.service";
import { ServiceError } from "@/lib/turbopay/services/types";

export async function GET(req: Request) {
  const limited = await rateLimit(req, { key: "stripe-pm-list", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  try {
    const methods = await stripeService.listPaymentMethods(user.id);
    return json({ data: methods });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message || "Failed to list payment methods", 500);
  }
}
