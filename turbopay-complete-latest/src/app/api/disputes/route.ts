import { requireUser } from "@/lib/turbopay/auth";
import { disputes, DISPUTE_TYPES } from "@/lib/turbocore/disputes";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { z } from "zod";

export async function GET() {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await disputes.listUserDisputes(user.id) });
}

const schema = z.object({
  transactionId: z.string().optional(), type: z.enum(DISPUTE_TYPES as any),
  subject: z.string().min(3).max(200), description: z.string().min(10).max(5000),
  amountDisputedKobo: z.number().int().optional(), priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});

export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "dispute", limit: 5, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  const dispute = await disputes.create(user.id, parsed.data);
  return json({ data: dispute }, 201);
}
