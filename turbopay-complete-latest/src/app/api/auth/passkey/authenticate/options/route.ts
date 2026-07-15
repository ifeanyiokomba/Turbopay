import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { generatePasskeyAuthenticationOptions } from "@/lib/turbopay/passkey";
import { z } from "zod";

const schema = z.object({
  identifier: z.string().min(1).optional(),
}).optional();

/** POST /api/auth/passkey/authenticate/options — generate WebAuthn authentication options. */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "passkey-auth", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const parsed = schema.safeParse(body);
  const identifier = parsed.success ? parsed.data?.identifier : undefined;

  const options = await generatePasskeyAuthenticationOptions(identifier);
  return json({ data: options });
}
