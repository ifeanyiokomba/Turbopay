import { requireUser, readIp } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { fraudEngine } from "@/lib/turbopay/services/fraud-engine";
import { z } from "zod";

const schema = z.object({
  amountKobo: z.number().int().positive(),
  operation: z.string().min(1),
  beneficiaryId: z.string().optional(),
});

/**
 * POST /api/fraud/evaluate — Evaluate fraud risk for a financial operation.
 * Returns a risk score and recommended action.
 */
export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  }

  const riskScore = await fraudEngine.evaluate({
    userId: user.id,
    amountKobo: parsed.data.amountKobo,
    operation: parsed.data.operation,
    ip: readIp(req.headers),
    userAgent: req.headers.get("user-agent") ?? undefined,
    beneficiaryId: parsed.data.beneficiaryId,
  });

  return json({ data: riskScore });
}
