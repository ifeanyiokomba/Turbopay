import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { walletService, ServiceError } from "@/lib/turbopay/services";
import { z } from "zod";

const schema = z.object({
  amountNaira: z.number().min(100, "Minimum funding is ₦100").max(500000, "Maximum funding is ₦500,000"),
});

/**
 * Demo funding flow: simulates the user transferring money into their
 * Monnify reserved account. Rate-limited (10/hour) to prevent demo abuse.
 */
export async function POST(req: Request) {
  // Rate limit demo funding to prevent abuse.
  const limited = await rateLimit(req, { key: "demo-fund", limit: 10, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  // Only admins can simulate funding — in ALL environments.
  // Previously this check was gated on NODE_ENV === "production", meaning
  // any authenticated user could create unlimited virtual funds in staging.
  // If staging shares a database with production (misconfiguration), this
  // becomes a real money creation vector.
  if (user.role !== "ADMIN") {
    return errorJson("This endpoint is admin-only.", 403, "FORBIDDEN");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid amount", 422, "VALIDATION");
  }

  try {
    const result = await walletService.fund({ user, amountNaira: parsed.data.amountNaira });
    return json({ data: result });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message ?? "Funding failed", 400);
  }
}
