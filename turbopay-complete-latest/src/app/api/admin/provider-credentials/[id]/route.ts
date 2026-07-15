import { db } from "@/lib/db";
import { providerConfig } from "@/lib/turbocore/config/provider-config";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

/**
 * PATCH /api/admin/provider-credentials/[id]
 *
 * Toggles enabled/disabled for a provider config.
 * BLOCKS enabling if required credential fields are missing.
 * Supports `force=true` to override the block (for sandbox/test use).
 */

const patchSchema = z.object({
  enabled: z.boolean(),
  force: z.boolean().optional(),
});

const PROVIDER_MANIFEST: Record<string, string[]> = {
  monnify: ["apiKey", "secretKey", "contractCode"],
  paystack: ["secretKey"],
  stripe: ["secretKey", "publishableKey", "webhookSecret"],
  remita: ["apiKey", "merchantId", "serviceTypeId", "secretKey"],
  quickteller: ["apiKey", "clientSecret", "merchantCode"],
  baxi: ["apiKey"],
  "gmail-smtp": ["user", "pass"],
  termii: ["apiKey"],
  resend: ["apiKey"],
  dojah: ["appId", "publicKey", "privateKey"],
  wise: ["token"],
  flutterwave: ["clientId", "clientSecret"],
  onafriq: ["apiKey"],
  otpdev: ["apiKey"],
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requirePermission(Permissions.ADMIN_MANAGE_PROVIDER_CREDENTIALS); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const user = await getSessionUser();
  const { id } = await params;

  let body;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const { enabled, force } = parsed.data;

  // If enabling, validate credentials are complete
  if (enabled && !force) {
    const config = await db.providerConfig.findUnique({ where: { id }, select: { providerName: true, credentialKeys: true, credentialsEnc: true } });
    if (!config) return errorJson("Provider config not found", 404, "NOT_FOUND");

    const requiredFields = PROVIDER_MANIFEST[config.providerName] ?? [];
    const configuredKeys: string[] = config.credentialKeys ? JSON.parse(config.credentialKeys) : [];
    const missingFields = requiredFields.filter((f) => !configuredKeys.includes(f));

    if (missingFields.length > 0) {
      return errorJson(
        `Cannot enable ${config.providerName}: missing required fields: ${missingFields.join(", ")}. Set all credentials first, or use force=true for sandbox testing.`,
        400,
        "INCOMPLETE_CREDENTIALS",
        { missingFields, requiredFields },
      );
    }

    if (!config.credentialsEnc) {
      return errorJson("Cannot enable: no credentials saved.", 400, "NO_CREDENTIALS");
    }
  }

  const actorInfo = user ? { id: user.id, name: user.fullName } : undefined;
  await providerConfig.update(id, { enabled }, actorInfo);
  return json({ data: { id, enabled } });
}
