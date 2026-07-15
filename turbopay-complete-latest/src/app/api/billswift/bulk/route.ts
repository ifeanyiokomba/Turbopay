import { billswift } from "@/lib/turbocore/billswift";
import { requireUser } from "@/lib/turbopay/auth";
import { verifyTransactionPin } from "@/lib/turbopay/pin";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

const schema = z.object({
  items: z.array(z.object({
    productCode: z.string().min(2),
    customer: z.string().min(4),
    customerName: z.string().optional(),
    amountNaira: z.number().min(50),
    meterType: z.enum(["PREPAID", "POSTPAID"]).optional(),
  })).min(1).max(1000),
  pin: z.string().regex(/^\d{4}$/, "Transaction PIN required"),
});

/** POST /api/billswift/bulk — create a bulk bill-processing job (queue-based). */
export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  // Per-user rate limit on PIN attempts — brute-force defense.
  const limited = await rateLimit(req, { key: "pin", limit: 10, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;

  // Transaction PIN required — this route debits the wallet.
  const pinCheck = await verifyTransactionPin(user, parsed.data.pin);
  if (!pinCheck.ok) return errorJson(pinCheck.error!, 400, pinCheck.code);

  const result = await billswift.createBulkJob(user.id, parsed.data.items);
  return json({ data: result });
}
