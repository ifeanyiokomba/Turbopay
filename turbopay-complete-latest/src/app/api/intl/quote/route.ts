import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json, handleError } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { fx, FxError } from "@/lib/turbocore/fx";
import { features } from "@/lib/turbocore/features";
import { z } from "zod";

const schema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
  amountMinor: z.number().int().min(1),
});

/**
 * GET /api/intl/quote?from=USD&to=NGN&amountMinor=100000 — get an FX quote.
 * POST /api/intl/quote — legacy compatibility (same logic, body instead of query).
 */
export async function GET(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const limited = await rateLimit(req, { key: "intl-quote", limit: 30, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;

  const enabled = await features.isEnabled("turbopay.intl", user.id);
  if (!enabled) return errorJson("International transfers are not yet available.", 403, "FEATURE_DISABLED");

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const amountMinor = searchParams.get("amountMinor");

  const parsed = schema.safeParse({
    from,
    to,
    amountMinor: amountMinor ? parseInt(amountMinor, 10) : undefined,
  });
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid query parameters", 422, "VALIDATION");

  try {
    const quote = await fx.getQuote(
      parsed.data.from as Parameters<typeof fx.getQuote>[0],
      parsed.data.to as Parameters<typeof fx.getQuote>[1],
      parsed.data.amountMinor,
      { userId: user.id },
    );
    return json({ data: quote });
  } catch (e: any) {
    return handleError(e);
  }
}

export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const enabled = await features.isEnabled("turbopay.intl", user.id);
  if (!enabled) return errorJson("International transfers are not yet available.", 403, "FEATURE_DISABLED");

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  try {
    const quote = await fx.getQuote(
      parsed.data.from as Parameters<typeof fx.getQuote>[0],
      parsed.data.to as Parameters<typeof fx.getQuote>[1],
      parsed.data.amountMinor,
      { userId: user.id },
    );
    return json({ data: quote });
  } catch (e: any) {
    return handleError(e);
  }
}
