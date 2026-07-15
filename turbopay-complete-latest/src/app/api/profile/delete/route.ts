import { db } from "@/lib/db";
import { requireUser, readIp } from "@/lib/turbopay/auth";
import { verifyPassword } from "@/lib/turbopay/crypto";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

/**
 * POST /api/profile/delete
 * Soft-deletes the authenticated user's account. The user must re-confirm
 * their password (Google OAuth users cannot self-delete via this endpoint —
 * they must contact support).
 *
 * Steps:
 *  1. Verify the supplied password against the stored hash.
 *  2. Set user.status = "DELETED" (soft delete — audit trail + relations
 *     preserved for NDPR retention window).
 *  3. Revoke ALL active sessions for the user (immediate sign-out
 *     everywhere).
 *  4. Audit the deletion (with the IP of the requester).
 *
 * The user's data is NOT hard-deleted at this point — that requires a
 * separate retention-driven purge job (NDPR allows a retention window for
 * fraud / AML / dispute records). After deletion the user can no longer
 * authenticate (requireUser() rejects status !== "ACTIVE").
 */
const schema = z.object({ password: z.string().min(1) });

export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson("Password is required", 422, "VALIDATION");

  // Look up the stored password hash. Google OAuth users (no passwordHash)
  // cannot self-delete — they must contact support for identity verification.
  const record = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, status: true } });
  if (!record) return errorJson("Account not found", 404);
  if (!record.passwordHash) return errorJson("Password-based deletion unavailable for this account — please contact support.", 400, "OAUTH_ACCOUNT");

  const passwordOk = verifyPassword(parsed.data.password, record.passwordHash);
  if (!passwordOk) return errorJson("Incorrect password", 401, "INVALID_PASSWORD");

  // Soft-delete: set status to DELETED. The requireUser() guard rejects any
  // status other than ACTIVE, so the user can no longer authenticate.
  await db.user.update({ where: { id: user.id }, data: { status: "DELETED" } });

  // Revoke all active sessions for this user (sign out everywhere).
  await db.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: {
      revokedAt: new Date(),
      refreshTokenHash: null,
      refreshExpiresAt: new Date(),
    },
  });

  await audit({
    userId: user.id,
    action: "ACCOUNT_DELETED",
    category: "AUTH",
    severity: "WARN",
    ip: readIp(req.headers),
    metadata: { method: "self_service_password_confirmed" },
  });

  return json({ data: { ok: true } });
}
