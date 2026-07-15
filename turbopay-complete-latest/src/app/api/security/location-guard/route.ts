import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { locationGuard } from "@/lib/turbopay/services";
import { z } from "zod";

/**
 * Location Guard — user configuration endpoint.
 *
 *   GET  /api/security/location-guard
 *     Returns the user's current guard config: `{ enabled }`.
 *
 *   PUT  /api/security/location-guard   body: `{ enabled: boolean }`
 *     Toggles the guard. When enabled, the debit pipeline checks whether
 *     the current request IP is in a /24 subnet the user has previously
 *     transacted from (any Device row with an IP in that subnet). If not,
 *     the pipeline throws `StepUpRequiredError` (HTTP 403) — the client
 *     reuses the same step-up OTP flow as the Large Transaction Shield
 *     (`/api/security/large-tx-step-up`) to verify the user, then retries
 *     the original debit.
 *
 * The guard is OFF by default; users opt in via Settings → Security →
 * Location Guard.
 */

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const cfg = await locationGuard.getConfig(user.id);
  return json({ data: { enabled: cfg.enabled } });
}

const putSchema = z.object({
  enabled: z.boolean(),
});

export async function PUT(req: Request) {
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
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      parsed.error.issues[0]?.message ?? "Invalid input",
      422,
      "VALIDATION",
    );
  }

  try {
    const cfg = await locationGuard.configure(user.id, parsed.data.enabled);
    return json({ data: { enabled: cfg.enabled } });
  } catch (e: any) {
    return errorJson(e.message ?? "Could not update Location Guard configuration", 400);
  }
}
