import { requireUser, readIp } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { kycService } from "@/lib/turbopay/services";
import { z } from "zod";

/**
 * POST /api/kyc/verify
 *
 * Generic identity verification — works across all providers and countries.
 * Routes to Paystack Identity (NG/GH) or Stripe Identity (rest of world)
 * based on the user's country.
 *
 * Rate-limited: 5 per hour per user.
 */
const schema = z.object({
  documentType: z.string().min(1, "Document type is required"),
  documentValue: z.string().min(1, "Document value is required"),
  phone: z.string().optional(),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const limited = await rateLimit(req, { key: "kyc-verify", limit: 5, windowMs: 3_600_000, scope: "user", userId: user.id });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  const ip = readIp(req.headers);
  const country = user.country ?? "NG";

  try {
    const result = await kycService.verifyIdentity(user.id, country, parsed.data, ip);
    return json({ data: result });
  } catch (e: any) {
    const message = e.message ?? "Identity verification failed";
    const status = e.status ?? 400;
    const code = e.code ?? "KYC_ERROR";
    return errorJson(message, status, code);
  }
}
