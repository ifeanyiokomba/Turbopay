import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { verifyPasskeyRegistration } from "@/lib/turbopay/passkey";
import { z } from "zod";

const schema = z.object({
  deviceName: z.string().min(1).max(100),
  deviceType: z.enum(["singleDevice", "multiDevice"]).default("singleDevice"),
  registrationResponse: z.any(), // WebAuthn RegistrationResponseJSON
  challengeId: z.string().min(1), // server-side challenge reference
});

/** POST /api/auth/passkey/register/verify — verify and store a new passkey. */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "passkey-register", limit: 5, windowMs: 60_000, scope: "user" });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const result = await verifyPasskeyRegistration(
    user.id,
    parsed.data.deviceName,
    parsed.data.deviceType,
    parsed.data.registrationResponse,
    parsed.data.challengeId
  );

  if (!result.verified) {
    return errorJson("Passkey registration failed", 400, "PASSKEY_REGISTRATION_FAILED");
  }

  return json({ data: { verified: true, credentialId: result.credentialId } });
}
