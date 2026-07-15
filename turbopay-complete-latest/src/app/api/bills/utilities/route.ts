import { requireUser, readIp } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { notify } from "@/lib/turbocore/notifications";
import { billingService, ServiceError } from "@/lib/turbopay/services";
import { DomainError } from "@/lib/turbopay/errors";
import { z } from "zod";

export async function GET() {
  return json({ data: { products: billingService.getBillProducts() } });
}

const validateSchema = z.object({
  action: z.literal("validate"),
  code: z.string().min(2),
  customer: z.string().min(4, "Enter the customer reference"),
});

const paySchema = z.object({
  action: z.literal("pay"),
  code: z.string().min(2),
  customer: z.string().min(4),
  customerName: z.string().min(2),
  productName: z.string().min(2),
  category: z.string().min(2),
  amountNaira: z.number().min(100, "Minimum is ₦100").max(200000, "Maximum is ₦200,000"),
  pin: z.string().regex(/^\d{4}$/, "Transaction PIN is required"),
});

export async function POST(req: Request) {
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
    return errorJson("Invalid request body", 400);
  }

  const action = (body as any)?.action;
  if (action === "validate") {
    const parsed = validateSchema.safeParse(body);
    if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
    try {
      const data = await billingService.validateUtility({
        user,
        code: parsed.data.code,
        customer: parsed.data.customer,
      });
      // Fire-and-forget in-app notification on successful validation.
      if (data.valid) {
        notify
          .sendInApp({
            userId: user.id,
            type: "TRANSACTION",
            title: "Customer Validated",
            message: `${parsed.data.code} customer ${parsed.data.customer} verified — ${data.customerName}`,
            actionUrl: "/bills",
            actionLabel: "Pay now",
          })
          .catch(() => null);
      }
      return json({ data });
    } catch (e: any) {
      if (e instanceof DomainError) return errorJson(e.message, e.statusCode, e.code, e.details);
      if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
      return errorJson(e.message ?? "Validation failed", 502, "PROVIDER_ERROR");
    }
  }

  const parsed = paySchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  // Per-user rate limit on PIN attempts — brute-force defense.
  const limited = await rateLimit(req, { key: "pin", limit: 10, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;

  try {
    const result = await billingService.payUtility({
      user,
      code: parsed.data.code,
      customer: parsed.data.customer,
      customerName: parsed.data.customerName,
      productName: parsed.data.productName,
      category: parsed.data.category,
      amountNaira: parsed.data.amountNaira,
      pin: parsed.data.pin,
      ip: readIp(req.headers),
    });
    return json({ data: result });
  } catch (e: any) {
    if (e instanceof DomainError) return errorJson(e.message, e.statusCode, e.code, e.details);
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message ?? "Bill payment failed", 400);
  }
}
