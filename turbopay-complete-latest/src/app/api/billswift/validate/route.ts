import { billswift } from "@/lib/turbocore/billswift";
import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

const schema = z.object({
  productCode: z.string().min(2),
  customer: z.string().min(4),
  meterType: z.enum(["PREPAID", "POSTPAID"]).optional(),
});

/** POST /api/billswift/validate — validate a customer reference before payment. */
export async function POST(req: Request) {
  try {
    await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  const result = await billswift.validate(parsed.data);
  return json({ data: result.ok && result.data ? result.data : { valid: false, customerName: "", message: "Validation failed" } });
}
