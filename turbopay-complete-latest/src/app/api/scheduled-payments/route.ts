import { requireUser } from "@/lib/turbopay/auth";
import { scheduledPayments } from "@/lib/turbocore/scheduled-payments";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await scheduledPayments.list(user.id) });
}

const schema = z.object({
  type: z.enum(["TRANSFER", "BILL_PAYMENT", "AIRTIME", "DATA"]),
  frequency: z.enum(["ONCE", "DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]),
  nextExecutionAt: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  customDates: z.array(z.string()).optional(),
  recipient: z.string().min(3), recipientName: z.string().optional(), bankName: z.string().optional(),
  amountKobo: z.number().int().min(5000), description: z.string().optional(),
  productCode: z.string().optional(), meterType: z.string().optional(),
});

export async function POST(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  const data: any = { ...parsed.data, nextExecutionAt: new Date(parsed.data.nextExecutionAt) };
  if (parsed.data.endDate) data.endDate = new Date(parsed.data.endDate);
  return json({ data: await scheduledPayments.create(user.id, data) }, 201);
}
