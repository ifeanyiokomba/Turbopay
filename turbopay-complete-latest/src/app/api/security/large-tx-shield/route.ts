import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { largeTxShield } from "@/lib/turbopay/services";
import { nairaToKobo } from "@/lib/turbopay/money";
import { z } from "zod";

/**
 * Large Transaction Shield — user configuration endpoint.
 *
 *   GET  /api/security/large-tx-shield
 *     Returns the user's current shield config: `{ enabled, thresholdKobo, thresholdNaira }`.
 *
 *   PUT  /api/security/large-tx-shield   body: `{ enabled: boolean, thresholdNaira?: number }`
 *     Updates the shield. `thresholdNaira` is optional (omit to keep the
 *     current threshold). Server converts naira → kobo (× 100) before
 *     persisting. The minimum allowed threshold is ₦100 (10_000 kobo) — a
 *     smaller value would trigger step-up on every micro-debit, which is
 *     not the shield's intent.
 *
 * The shield is OFF by default; users opt in via Settings → Security →
 * Large Transaction Shield.
 */

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const cfg = await largeTxShield.getConfig(user.id);
  return json({
    data: {
      enabled: cfg.enabled,
      thresholdKobo: cfg.thresholdKobo,
      thresholdNaira: cfg.thresholdKobo / 100,
    },
  });
}

const putSchema = z.object({
  enabled: z.boolean(),
  thresholdNaira: z.number().min(100, "Minimum threshold is ₦100").max(5_000_000, "Maximum threshold is ₦5,000,000").optional(),
});

export async function PUT(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid body", 400);
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      parsed.error.issues[0]?.message ?? "Invalid input",
      422,
      "VALIDATION",
    );
  }

  try {
    const cfg = await largeTxShield.configure(user.id, {
      enabled: parsed.data.enabled,
      thresholdKobo: parsed.data.thresholdNaira !== undefined
        ? nairaToKobo(parsed.data.thresholdNaira)
        : undefined,
    });
    return json({
      data: {
        enabled: cfg.enabled,
        thresholdKobo: cfg.thresholdKobo,
        thresholdNaira: cfg.thresholdKobo / 100,
      },
    });
  } catch (e: any) {
    return errorJson(e.message ?? "Could not update shield configuration", 400);
  }
}
