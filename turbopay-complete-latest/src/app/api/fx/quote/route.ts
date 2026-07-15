import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json, handleError } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { fx, FxError } from "@/lib/turbocore/fx";
import { features } from "@/lib/turbocore/features";
import { z } from "zod";

const querySchema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
  amount: z.coerce.number().int().min(1),
});

/**
 * GET /api/fx/quote?from=USD&to=NGN&amount=100000
 *
 * Public-ish (any authenticated user) FX quote endpoint. Delegates to the
 * TurboCore FX Engine which validates the pair against the whitelist, gets a
 * fresh rate snapshot (refreshing if expired), applies the configured spread,
 * computes the destination amount + platform fee, and audits the quote.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const limited = await rateLimit(req, { key: "fx-quote", limit: 30, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;
  // Feature-gated: international transfers are inactive until enabled.
  const enabled = await features.isEnabled("turbopay.intl", user.id);
  if (!enabled) {
    return errorJson("International transfers are not yet available.", 403, "FEATURE_DISABLED");
  }
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    amount: url.searchParams.get("amount") ?? "",
  });
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid query", 422, "VALIDATION");
  }
  const { from, to, amount } = parsed.data;
  try {
    const quote = await fx.getQuote(
      from as Parameters<typeof fx.getQuote>[0],
      to as Parameters<typeof fx.getQuote>[1],
      amount,
      { userId: user.id },
    );
    return json({ data: quote });
  } catch (e: any) {
    return handleError(e);
  }
}
