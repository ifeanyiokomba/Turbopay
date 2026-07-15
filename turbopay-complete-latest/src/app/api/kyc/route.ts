import { requireUser, readIp } from "@/lib/turbopay/auth";
import { errorJson, json, handleError } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { kycService, ServiceError } from "@/lib/turbopay/services";
import { z } from "zod";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const data = await kycService.getStatus(user.id, user.kycTier, user.kycStatus);
  return json({ data });
}

const schema = z.object({
  tier: z.union([z.literal(2), z.literal(3)]),
  nin: z.string().regex(/^\d{11}$/, "NIN must be 11 digits").optional(),
  bvn: z.string().regex(/^\d{11}$/, "BVN must be 11 digits").optional(),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const limited = await rateLimit(req, { key: "kyc", limit: 5, windowMs: 3_600_000, scope: "user", userId: user.id });
  if (limited) return limited;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  const { tier, nin, bvn } = parsed.data;
  const ip = readIp(req.headers);

  try {
    if (tier === 2) {
      if (!nin) return errorJson("NIN is required for Tier 2", 422, "VALIDATION");
      const result = await kycService.verifyNin(user.id, nin, user.phone, ip);
      return json({ data: result });
    }
    // tier 3
    if (!bvn) return errorJson("BVN is required for Tier 3", 422, "VALIDATION");
    const result = await kycService.verifyBvn(user.id, user.kycTier, bvn, user.phone, ip);
    return json({ data: result });
  } catch (e: any) {
    return handleError(e);
  }
}
