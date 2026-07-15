import { requireUser } from "@/lib/turbopay/auth";
import { savings } from "@/lib/turbocore/savings";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await savings.list(user.id) });
}

const schema = z.object({
  name: z.string().min(2), type: z.enum(["FLEXIBLE", "LOCKED", "TARGET", "GOAL", "ROUND_UP", "AUTO_SAVE"]),
  targetAmountKobo: z.number().int().optional(), lockUntil: z.string().datetime().optional(),
  interestRateBps: z.number().int().optional(), autoSaveAmountKobo: z.number().int().optional(), autoSaveFrequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
});

export async function POST(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  try { return json({ data: await savings.create(user.id, { ...parsed.data, lockUntil: parsed.data.lockUntil ? new Date(parsed.data.lockUntil) : undefined }) }, 201); }
  catch (e: any) { return errorJson(e.message, 400); }
}
