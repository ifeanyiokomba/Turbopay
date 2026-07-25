import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { stripeService } from "@/lib/turbopay/services/stripe.service";
import { ServiceError } from "@/lib/turbopay/services/types";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(req, { key: "stripe-pm-delete", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { id: paymentMethodId } = await params;

  try {
    const result = await stripeService.detachPaymentMethod(user.id, paymentMethodId);
    return json({ data: result });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message || "Failed to remove payment method", 500);
  }
}
