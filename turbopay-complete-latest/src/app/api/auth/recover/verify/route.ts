import { recovery } from "@/lib/turbocore/recovery";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { z } from "zod";

/**
 * POST /api/auth/recover/verify
 *
 * Second step of the account recovery flow — verifies the OTP that was sent
 * (via email or SMS) when the user called `/api/auth/recover`. On success the
 * recovery attempt transitions OTP_SENT → VERIFIED, and the user may then call
 * `/api/auth/recover/complete` to actually reset their password/PIN or reveal
 * their username.
 *
 * Rate-limited: 5 attempts per 15 minutes per IP. This is tighter than the
 * initiate route (5/hour) because OTP brute-force is the higher-risk attack
 * surface here — a verified recovery attempt unlocks a password reset.
 */

const schema = z.object({
  attemptId: z.string().min(1, "Missing attemptId"),
  otp: z.string().min(4, "Missing OTP").max(10, "Invalid OTP"),
});

export async function POST(req: Request) {
  // OTP brute-force defence: 5 attempts / 15 minutes / IP.
  const limited = await rateLimit(req, { key: "otp-verify", limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

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

  const result = await recovery.verifyOtp({
    attemptId: parsed.data.attemptId,
    otp: parsed.data.otp,
  });

  if (!result.verified) {
    // 422 Unprocessable — the request was well-formed but the OTP didn't match.
    return json({ data: { verified: false, reason: result.reason ?? "INVALID_OR_EXPIRED_OTP" } }, 422);
  }

  return json({ data: { verified: true, recoveryType: result.recoveryType } });
}
