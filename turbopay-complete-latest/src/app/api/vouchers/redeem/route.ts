import { requireUser } from "@/lib/turbopay/auth";
import { vouchers } from "@/lib/turbocore/vouchers";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

const schema = z.object({ code: z.string().min(3), product: z.string().min(2), amountKobo: z.number().int().min(0), transactionId: z.string().min(1) });

export async function POST(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  const result = await vouchers.redeem(parsed.data.code, { userId: user.id, transactionId: parsed.data.transactionId, product: parsed.data.product, amountKobo: parsed.data.amountKobo, kycTier: user.kycTier });
  if (!result.redeemed) return errorJson(result.reason ?? "Voucher could not be redeemed", 400, "VOUCHER_INVALID");
  return json({ data: result });
}
