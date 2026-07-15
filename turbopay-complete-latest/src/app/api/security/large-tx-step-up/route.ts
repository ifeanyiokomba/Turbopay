import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { largeTxShield } from "@/lib/turbopay/services";
import { z } from "zod";

/**
 * POST /api/security/large-tx-step-up
 *
 * Step-up OTP flow for the Large Transaction Shield. When the debit pipeline
 * throws `StepUpRequiredError` (HTTP 403, code `STEP_UP_REQUIRED`), the
 * client:
 *
 *   1. POSTs `{ action: "initiate", amountKobo }` to this route. The server
 *      records a 6-digit OTP (5-minute TTL, single-use) via the shared
 *      `requireStepUp` helper from the security service. In dev/sandbox the
 *      OTP is returned for the notification mock; in production it is
 *      delivered via SMS/email and only `{ sent: true, expiresAt }` is
 *      returned.
 *   2. The user enters the OTP. The client POSTs
 *      `{ action: "verify", otp }`. On success the server returns
 *      `{ ok: true }` and the client retries the original debit request.
 *
 * The `amountKobo` on the initiate call is used for the audit trail + the
 * security timeline event (`STEP_UP_REQUIRED` with the amount metadata) so
 * the user can see WHEN step-up was triggered for a high-value transaction.
 */

const schema = z.object({
  action: z.enum(["initiate", "verify"]),
  amountKobo: z.number().int().positive().optional(),
  otp: z.string().regex(/^\d{6}$/).optional(),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid body", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      parsed.error.issues[0]?.message ?? "Invalid input",
      422,
      "VALIDATION",
    );
  }

  if (parsed.data.action === "initiate") {
    if (!parsed.data.amountKobo) {
      return errorJson("amountKobo is required for initiation", 422, "VALIDATION");
    }
    const { otp, expiresAt } = await largeTxShield.initiateStepUp(
      user.id,
      parsed.data.amountKobo,
    );
    // In production, the OTP is delivered via SMS/email — never return it to
    // the client. In dev/sandbox, return it so the notification mock can
    // surface it (the existing /api/security/step-up route follows the same
    // convention).
    if (process.env.NODE_ENV === "production") {
      return json({ data: { sent: true, expiresAt: expiresAt.toISOString() } });
    }
    return json({ data: { otp, expiresAt: expiresAt.toISOString() } });
  }

  // verify
  if (!parsed.data.otp) {
    return errorJson("OTP is required for verification", 422, "VALIDATION");
  }
  const ok = await largeTxShield.verifyStepUp(user.id, parsed.data.otp);
  if (!ok) {
    return errorJson("Invalid or expired OTP", 401, "STEP_UP_FAILED");
  }
  return json({ data: { ok: true } });
}
