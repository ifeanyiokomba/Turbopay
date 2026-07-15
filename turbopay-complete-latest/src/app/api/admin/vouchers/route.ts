import { vouchers } from "@/lib/turbocore/vouchers";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FEES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await vouchers.list() });
}

const schema = z.object({
  code: z.string().min(3), campaignName: z.string().min(2), type: z.enum(["DISCOUNT", "CASHBACK", "FEE_WAIVER", "PERCENT_OFF", "FLAT_OFF"]),
  valueKobo: z.number().int().optional(), valueBps: z.number().int().optional(), maxDiscountKobo: z.number().int().optional(),
  minSpendKobo: z.number().int().optional(), eligibleProducts: z.array(z.string()).optional(), excludedProducts: z.array(z.string()).optional(),
  applicableKycTiers: z.array(z.number()).optional(), newCustomerOnly: z.boolean().optional(), returningOnly: z.boolean().optional(),
  referralRequired: z.boolean().optional(), oneTimeUse: z.boolean().optional(), usageLimit: z.number().int().optional(),
  perUserLimit: z.number().int().optional(), campaignBudgetKobo: z.number().int().optional(),
  startDate: z.string().datetime().optional(), endDate: z.string().datetime().optional(),
  currencyRestriction: z.string().optional(), regionRestriction: z.string().optional(), providerRestriction: z.string().optional(),
});

export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FEES); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  const data: any = { ...parsed.data };
  if (parsed.data.startDate) data.startDate = new Date(parsed.data.startDate);
  if (parsed.data.endDate) data.endDate = new Date(parsed.data.endDate);
  return json({ data: await vouchers.create(data) }, 201);
}
