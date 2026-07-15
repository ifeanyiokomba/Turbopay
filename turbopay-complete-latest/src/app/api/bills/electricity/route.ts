import { requireUser, readIp } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { notify } from "@/lib/turbocore/notifications";
import { billingService, ServiceError } from "@/lib/turbopay/services";
import { DomainError } from "@/lib/turbopay/errors";
import { z } from "zod";

export async function GET() {
  return json({ data: { discos: billingService.getDiscos() } });
}

const validateSchema = z.object({
  action: z.literal("validate"),
  discoCode: z.string().min(2),
  meterNumber: z.string().min(8, "Enter a valid meter number"),
  meterType: z.enum(["PREPAID", "POSTPAID"]),
});

const paySchema = z.object({
  action: z.literal("pay"),
  discoCode: z.string().min(2),
  meterNumber: z.string().min(8),
  meterType: z.enum(["PREPAID", "POSTPAID"]),
  amountNaira: z.number().min(500, "Minimum is ₦500").max(100000, "Maximum is ₦100,000"),
  customerName: z.string().min(2),
  discoName: z.string().min(2),
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
      const data = await billingService.validateElectricity({
        user,
        discoCode: parsed.data.discoCode,
        meterNumber: parsed.data.meterNumber,
        meterType: parsed.data.meterType,
      });
      // Fire-and-forget in-app notification on successful validation.
      if (data.valid) {
        notify
          .sendInApp({
            userId: user.id,
            type: "TRANSACTION",
            title: "Meter Validated",
            message: `${parsed.data.discoCode} meter ${parsed.data.meterNumber} verified — customer: ${data.customerName}`,
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
    const result = await billingService.payElectricity({
      user,
      discoCode: parsed.data.discoCode,
      discoName: parsed.data.discoName,
      meterNumber: parsed.data.meterNumber,
      meterType: parsed.data.meterType,
      customerName: parsed.data.customerName,
      amountNaira: parsed.data.amountNaira,
      pin: parsed.data.pin,
      ip: readIp(req.headers),
    });
    return json({ data: result });
  } catch (e: any) {
    if (e instanceof DomainError) return errorJson(e.message, e.statusCode, e.code, e.details);
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message ?? "Electricity payment failed", 400);
  }
}
