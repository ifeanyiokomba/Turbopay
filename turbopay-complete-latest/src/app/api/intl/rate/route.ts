import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json, handleError } from "@/lib/turbopay/api";
import { fx, FxError } from "@/lib/turbocore/fx";
import { rateLimit } from "@/lib/turbopay/rate-limit";

/**
 * GET /api/intl/rate?from=USD&to=NGN&amountMinor=100000 — get a live exchange rate.
 */
export async function GET(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const limited = await rateLimit(req, { key: "intl-rate", limit: 60, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const amountMinor = searchParams.get("amountMinor");

  if (!from || !to || !amountMinor) {
    return errorJson("Missing from, to, or amountMinor", 422);
  }

  try {
    const quote = await fx.getQuote(
      from as Parameters<typeof fx.getQuote>[0],
      to as Parameters<typeof fx.getQuote>[1],
      parseInt(amountMinor, 10),
      { userId: user.id },
    );
    return json({ data: quote });
  } catch (e: any) {
    return handleError(e);
  }
}
