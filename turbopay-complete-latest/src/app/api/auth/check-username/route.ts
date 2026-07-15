import { db } from "@/lib/db";
import { json, errorJson } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { isReserved } from "@/lib/turbopay/reserved-usernames";
import { z } from "zod";

const schema = z.object({ username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/) });

export async function POST(req: Request) {
  // Rate limit: 10 checks / minute per IP (reduced from 30 to narrow the
  // username enumeration window). The route reveals whether a username is
  // taken (by design — the registration form needs to know). 10/min is
  // enough for a human trying a few candidates in a form but makes
  // scripted directory harvesting significantly slower.
  const limited = await rateLimit(req, { key: "check-username", limit: 10, windowMs: 60 * 1000 });
  if (limited) return limited;

  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson("Username must be 3-20 chars, letters/numbers/underscores only", 422, "VALIDATION");
  const lower = parsed.data.username.toLowerCase();
  if (isReserved(lower)) return json({ data: { available: false, reason: "RESERVED" } });
  const existing = await db.user.findUnique({ where: { username: lower } });
  return json({ data: { available: !existing, reason: existing ? "TAKEN" : "AVAILABLE" } });
}
