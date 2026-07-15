import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { intentService, ServiceError } from "@/lib/turbopay/services";
import { z } from "zod";

/**
 * Payment Intent — status polling + cancellation endpoint.
 *
 *   GET   /api/payment-intent/[id]
 *     Returns the intent's current status + metadata. Used by the client to
 *     poll whether a payment is still PROCESSING or has reached a terminal
 *     state (SUCCEEDED / FAILED / CANCELLED). The intent must belong to the
 *     authenticated user — probing another user's intent ID returns 404 (not
 *     403) so an attacker can't enumerate IDs.
 *
 *   PATCH /api/payment-intent/[id]   body: { action: "cancel" }
 *     Cancels a PENDING intent. Once an intent is PROCESSING (the pipeline
 *     has picked it up), cancellation is no longer safe — the financial
 *     transaction is in flight. Returns 409 in that case.
 */

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const { id } = await ctx.params;
  const intent = await intentService.get(id, user.id);
  if (!intent) {
    return errorJson("Payment intent not found", 404, "INTENT_NOT_FOUND");
  }

  // Parse the metadata JSON for the client (it stores transactionId on
  // success, failureReason on failure).
  let metadata: Record<string, unknown> | null = null;
  if (intent.metadata) {
    try {
      metadata = JSON.parse(intent.metadata) as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  }

  return json({
    data: {
      id: intent.id,
      type: intent.type,
      amountKobo: intent.amountKobo,
      currency: intent.currency,
      status: intent.status,
      recipient: intent.recipient,
      metadata,
      idempotencyKey: intent.idempotencyKey,
      createdAt: intent.createdAt.toISOString(),
      updatedAt: intent.updatedAt.toISOString(),
    },
  });
}

const patchSchema = z.object({
  action: z.literal("cancel"),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
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
    return errorJson("Invalid request body", 400);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      parsed.error.issues[0]?.message ?? "Invalid action",
      422,
      "VALIDATION",
    );
  }

  const { id } = await ctx.params;

  try {
    if (parsed.data.action === "cancel") {
      await intentService.cancel(id, user.id);
      return json({ data: { id, status: "CANCELLED" } });
    }
    // Unreachable — schema enforces action === "cancel".
    return errorJson("Unsupported action", 422, "VALIDATION");
  } catch (e: any) {
    if (e instanceof ServiceError) {
      return errorJson(e.message, e.status, e.code);
    }
    return errorJson(e.message ?? "Could not update payment intent", 400);
  }
}
