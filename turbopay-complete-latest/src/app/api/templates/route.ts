import { requireUser } from "@/lib/turbopay/auth";
import { paymentTemplates } from "@/lib/turbocore/templates";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await paymentTemplates.list(user.id) });
}

const schema = z.object({
  name: z.string().min(2), type: z.enum(["TRANSFER", "BILL_PAYMENT", "AIRTIME", "DATA"]),
  recipient: z.string().optional(), recipientName: z.string().optional(), bankName: z.string().optional(), bankCode: z.string().optional(),
  productCode: z.string().optional(), productName: z.string().optional(), customerRef: z.string().optional(), meterType: z.string().optional(),
  defaultAmountKobo: z.number().int().optional(), description: z.string().optional(), isFavorite: z.boolean().default(false),
});

export async function POST(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  return json({ data: await paymentTemplates.create(user.id, parsed.data) }, 201);
}
