import { recovery } from "@/lib/turbocore/recovery";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

/**
 * POST /api/auth/recover/complete
 *
 * Final step of the account recovery flow — performs the actual recovery
 * action (reset password, reset PIN, reveal username). The caller MUST have
 * already verified the OTP via `/api/auth/recover/verify`.
 *
 * Body:
 *   - attemptId  (string, required)
 *   - newPassword (string, optional — required for FORGOT_PASSWORD)
 *   - newPin     (string, optional — required for FORGOT_PIN)
 *   At least ONE of newPassword / newPin must be present for the password/PIN
 *   flows. For FORGOT_USERNAME neither is required.
 *
 * Rate-limiting is intentionally NOT applied here — the OTP-verify step is
 * the brute-force surface, and an unverified attempt can't reach this route
 * anyway (the service rejects with NOT_VERIFIED). An attacker who somehow
 * obtained a verified attemptId already has the keys.
 */

const schema = z
  .object({
    attemptId: z.string().min(1, "Missing attemptId"),
    newPassword: z.string().min(8, "Password must be at least 8 characters").optional(),
    newPin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits").optional(),
  })
  .refine((data) => data.newPassword !== undefined || data.newPin !== undefined, {
    message: "Provide either newPassword or newPin",
    path: ["newPassword"],
  });

export async function POST(req: Request) {
  let body;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid body", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  }

  const result = await recovery.complete({
    attemptId: parsed.data.attemptId,
    newPassword: parsed.data.newPassword,
    newPin: parsed.data.newPin,
  });

  if (!result.completed) {
    // 422 — the request was well-formed but the recovery can't proceed
    // (e.g. missing newPassword, or REQUIRES_SUPPORT_TICKET for ACCOUNT_LOCKED).
    return json({ data: { completed: false, reason: result.reason ?? "UNKNOWN" } }, 422);
  }

  return json({
    data: {
      completed: true,
      username: (result as { username?: string | null }).username ?? null,
      fullName: (result as { fullName?: string | null }).fullName ?? null,
    },
  });
}
