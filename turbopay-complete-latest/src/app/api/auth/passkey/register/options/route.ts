import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { generatePasskeyRegistrationOptions } from "@/lib/turbopay/passkey";

/** POST /api/auth/passkey/register/options — generate WebAuthn registration options. */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "passkey-register", limit: 5, windowMs: 60_000, scope: "user" });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const options = await generatePasskeyRegistrationOptions(user.id, user.email ?? user.phone ?? "unknown");
  return json({ data: options });
}
