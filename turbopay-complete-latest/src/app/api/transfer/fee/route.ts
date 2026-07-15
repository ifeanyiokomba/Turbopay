import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { fees } from "@/lib/turbocore/fees";
import { z } from "zod";

const schema = z.object({
  amountNaira: z.number().min(50).max(5_000_000),
  type: z.enum(["internal", "external"]),
});

export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  const amountKobo = Math.round(parsed.data.amountNaira * 100);

  if (parsed.data.type === "internal") {
    return json({ data: { feeKobo: 0, feeNaira: 0, totalDebitKobo: amountKobo, totalDebitNaira: parsed.data.amountNaira } });
  }

  const result = await fees.calculate("turbopay", "TRANSFER", amountKobo, { kycTier: user.kycTier });
  const feeNaira = result.feeMinor / 100;
  return json({
    data: {
      feeKobo: result.feeMinor,
      feeNaira,
      totalDebitKobo: amountKobo + result.feeMinor,
      totalDebitNaira: parsed.data.amountNaira + feeNaira,
    },
  });
}
