import { recovery, RECOVERY_TYPES } from "@/lib/turbocore/recovery";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { readIp } from "@/lib/turbopay/auth";
import { z } from "zod";

const schema = z.object({
  identifier: z.string().min(3, "Enter your email, phone, or username"),
  recoveryType: z.enum(RECOVERY_TYPES as any),
});

export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "recovery", limit: 5, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  const ip = readIp(req.headers);
  const ua = req.headers.get("user-agent") ?? undefined;
  const result = await recovery.initiate({ identifier: parsed.data.identifier, recoveryType: parsed.data.recoveryType, ip, userAgent: ua });
  return json({ data: result });
}
