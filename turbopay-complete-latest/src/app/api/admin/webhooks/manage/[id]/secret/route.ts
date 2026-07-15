import { webhookManagement } from "@/lib/turbocore/config/webhook-management";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { verifyStepUp } from "@/lib/turbocore/security";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

/**
 * POST /api/admin/webhooks/manage/[id]/secret
 *
 * Set / update the encrypted webhook HMAC signing secret.
 *
 * SECURITY: This is a high-risk write — a compromised or incorrect webhook
 * secret silently disables signature verification for an entire inbound
 * payment channel, so an attacker could forge funding / transfer webhooks.
 * We therefore require a fresh step-up OTP (single-use, 5-minute TTL) on
 * EVERY secret write, in addition to the ADMIN_MANAGE_WEBHOOKS permission.
 *
 * Client flow:
 *   1. POST /api/security/step-up { action:"initiate", reason:"webhook_secret_change" }
 *      → { otp } (dev/sandbox) or { sent:true } (prod)
 *   2. POST this route { secret, otp } — the otp is verified + consumed here.
 */
const schema = z.object({
  secret: z.string().min(16, "Secret must be at least 16 characters"),
  otp: z.string().regex(/^\d{6}$/, "A 6-digit step-up OTP is required"),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requirePermission(Permissions.ADMIN_MANAGE_WEBHOOKS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  // Step-up OTP gate — verify before touching the secret.
  const otpOk = await verifyStepUp(user.id, parsed.data.otp);
  if (!otpOk) {
    return errorJson(
      "Invalid or expired step-up OTP. Re-initiate the verification and try again.",
      401,
      "STEP_UP_FAILED",
    );
  }

  try {
    const result = await webhookManagement.setSecret(id, parsed.data.secret, user ? { id: user.id, name: user.fullName } : undefined);
    return json({ data: result });
  } catch (e: any) {
    return errorJson(e.message, 404, "NOT_FOUND");
  }
}
