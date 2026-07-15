import { requireUser } from "@/lib/turbopay/auth";
import { savings } from "@/lib/turbocore/savings";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { z } from "zod";

const schema = z.object({ amountKobo: z.number().int().min(5000) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const limited = await rateLimit(req, { key: "savings-deposit", limit: 10, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;
  const { id } = await params;
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  try { await savings.deposit(id, user.id, parsed.data.amountKobo); return json({ data: { ok: true } }); }
  catch (e: any) { return errorJson(e.message, 400); }
}
