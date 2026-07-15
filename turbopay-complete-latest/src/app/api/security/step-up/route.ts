import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { requireStepUp, verifyStepUp } from "@/lib/turbocore/security";
import { z } from "zod";

/**
 * POST /api/security/step-up
 *  - { action: "initiate", reason: "large_transfer" } → { otp, expiresAt } (dev) / { sent: true } (prod)
 *  - { action: "verify", otp: "123456" }              → { ok: boolean }
 */
const schema = z.object({
  action: z.enum(["initiate", "verify"]),
  reason: z.string().min(2).optional(),
  otp: z.string().regex(/^\d{6}$/).optional(),
});

export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  if (parsed.data.action === "initiate") {
    const reason = parsed.data.reason ?? "generic";
    const { otp, expiresAt } = await requireStepUp(user.id, reason);
    // In dev/sandbox, return the OTP for the notification mock. In production,
    // the OTP is delivered via SMS/email and only { sent: true } is returned.
    if (process.env.NODE_ENV === "production") {
      return json({ data: { sent: true, expiresAt: expiresAt.toISOString() } });
    }
    return json({ data: { otp, expiresAt: expiresAt.toISOString() } });
  }

  // verify
  if (!parsed.data.otp) return errorJson("OTP is required for verification", 422, "VALIDATION");
  const ok = await verifyStepUp(user.id, parsed.data.otp);
  if (!ok) return errorJson("Invalid or expired OTP", 401, "STEP_UP_FAILED");
  return json({ data: { ok: true } });
}
