import { requireUser, readIp } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { billingService, ServiceError } from "@/lib/turbopay/services";
import { DomainError } from "@/lib/turbopay/errors";
import { z } from "zod";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const network = searchParams.get("network") ?? undefined;
  return json({ data: { plans: billingService.getDataPlans(network ?? undefined) } });
}

const schema = z.object({
  phoneNumber: z.string().regex(/^\+234[0-9]{10}$/, "Use format +2348012345678"),
  planId: z.string().min(1),
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
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  // Per-user rate limit on PIN attempts — brute-force defense.
  const limited = await rateLimit(req, { key: "pin", limit: 10, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;

  try {
    const result = await billingService.buyData({
      user,
      phoneNumber: parsed.data.phoneNumber,
      planId: parsed.data.planId,
      pin: parsed.data.pin,
      ip: readIp(req.headers),
    });
    return json({ data: result });
  } catch (e: any) {
    if (e instanceof DomainError) return errorJson(e.message, e.statusCode, e.code, e.details);
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message ?? "Data purchase failed", 400);
  }
}
