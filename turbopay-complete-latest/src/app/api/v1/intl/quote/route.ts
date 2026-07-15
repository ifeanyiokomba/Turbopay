import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json, handleError } from "@/lib/turbopay/api";
import { fx, FxError } from "@/lib/turbocore/fx";
import { features } from "@/lib/turbocore/features";
import { z } from "zod";

const schema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
  amountMinor: z.number().int().min(1),
});

/**
 * GET /api/v1/intl/quote — Get FX quote for currency conversion.
 *
 * Versioned endpoint with stable response contract.
 * Query params: from, to, amountMinor
 */
export async function GET(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const enabled = await features.isEnabled("turbopay.intl", user.id);
  if (!enabled) return errorJson("International transfers are not available.", 403, "FEATURE_DISABLED");

  const { searchParams } = new URL(req.url);
  const parsed = schema.safeParse({
    from: searchParams.get("from"),
    to: searchParams.get("to"),
    amountMinor: searchParams.get("amountMinor") ? parseInt(searchParams.get("amountMinor")!, 10) : undefined,
  });
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid query", 422, "VALIDATION");

  try {
    const quote = await fx.getQuote(
      parsed.data.from as any,
      parsed.data.to as any,
      parsed.data.amountMinor,
      { userId: user.id },
    );
    return json({
      data: {
        from: quote.from,
        to: quote.to,
        rate: quote.rate,
        sourceAmountMinor: parsed.data.amountMinor,
        destinationAmountMinor: quote.destinationAmountMinor,
        platformFeeMinor: quote.platformFeeMinor,
        expiresAt: quote.expiresAt,
      },
      meta: { version: "1.0.0", timestamp: new Date().toISOString() },
    });
  } catch (e: any) {
    return handleError(e);
  }
}
