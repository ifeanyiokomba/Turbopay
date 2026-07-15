import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { listPasskeys, removePasskey } from "@/lib/turbopay/passkey";
import { z } from "zod";

/**
 * GET /api/auth/passkeys — list all passkeys for the authenticated user.
 * DELETE /api/auth/passkeys — remove a passkey.
 */
export async function GET(req: Request) {
  const limited = await rateLimit(req, { key: "passkeys", limit: 10, windowMs: 60_000, scope: "user" });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const passkeys = await listPasskeys(user.id);
  return json({ data: passkeys });
}

const deleteSchema = z.object({ passkeyId: z.string().min(1) });

export async function DELETE(req: Request) {
  const limited = await rateLimit(req, { key: "passkeys", limit: 5, windowMs: 60_000, scope: "user" });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const removed = await removePasskey(user.id, parsed.data.passkeyId);
  if (!removed) return errorJson("Passkey not found", 404, "NOT_FOUND");

  return json({ data: { ok: true } });
}
