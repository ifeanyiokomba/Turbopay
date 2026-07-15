import { db } from "@/lib/db";
import { requireUser, readIp, regenerateAccessToken } from "@/lib/turbopay/auth";
import { hashToken } from "@/lib/turbopay/crypto";
import { audit } from "@/lib/turbopay/audit";
import { isReserved } from "@/lib/turbopay/reserved-usernames";
import { errorJson, json } from "@/lib/turbopay/api";
import { cookies } from "next/headers";
import { z } from "zod";

const schema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bio: z.string().max(200).nullable().optional(),
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(7).max(20).optional(),
});

export async function PATCH(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  // Email/phone are account-recovery surfaces — require step-up authentication
  // (PIN or OTP) before allowing changes. This prevents a stolen session from
  // hijacking the account via the new contact channel.
  const contactChanging = parsed.data.email !== undefined || parsed.data.phone !== undefined;
  if (contactChanging) {
    const { verifyTransactionPin } = await import("@/lib/turbopay/pin");
    const pin = (body as any).pin;
    if (!pin) return errorJson("Transaction PIN is required to change email or phone", 400, "PIN_REQUIRED");
    const pinResult = await verifyTransactionPin(user, pin);
    if (!pinResult.ok) return errorJson(pinResult.error ?? "Invalid PIN", 400, pinResult.code);
  }

  const data: Record<string, unknown> = {};
  // Track whether email/phone is being changed so we know to rotate the
  // session afterward. Username/avatar/bio/fullName changes don't warrant
  // rotation (they don't affect account-recovery surfaces).
  let contactChanged = false;
  if (parsed.data.fullName !== undefined) data.fullName = parsed.data.fullName;
  if (parsed.data.bio !== undefined) data.bio = parsed.data.bio;
  if (parsed.data.avatarUrl !== undefined) data.avatarUrl = parsed.data.avatarUrl;
  if (parsed.data.username !== undefined) {
    const lower = parsed.data.username.toLowerCase();
    if (isReserved(lower)) return errorJson("This username is reserved and cannot be used", 409, "RESERVED");
    const existing = await db.user.findFirst({ where: { username: lower, NOT: { id: user.id } } });
    if (existing) return errorJson("This username is already taken", 409, "DUPLICATE");
    // Record the old username in history before changing.
    const currentUser = await db.user.findUnique({ where: { id: user.id }, select: { username: true } });
    if (currentUser?.username) {
      await db.usernameHistory.create({ data: { userId: user.id, username: currentUser.username } });
    }
    data.username = lower;
  }
  if (parsed.data.email !== undefined) {
    const lower = parsed.data.email.toLowerCase();
    // Uniqueness check across all users.
    const existing = await db.user.findFirst({ where: { email: lower, NOT: { id: user.id } } });
    if (existing) return errorJson("An account with these details already exists.", 409, "DUPLICATE_DETAILS");
    data.email = lower;
    // F3 FIX: Reset emailVerified when the email changes — the new address
    // must be re-verified before it can be used for account recovery.
    data.emailVerified = false;
    contactChanged = true;
  }
  if (parsed.data.phone !== undefined) {
    const existing = await db.user.findFirst({ where: { phone: parsed.data.phone, NOT: { id: user.id } } });
    if (existing) return errorJson("An account with these details already exists.", 409, "DUPLICATE_DETAILS");
    data.phone = parsed.data.phone;
    // F3 FIX: Reset phoneVerified when the phone changes.
    data.phoneVerified = false;
    contactChanged = true;
  }

  const updated = await db.user.update({ where: { id: user.id }, data });
  await audit({
    userId: user.id,
    action: "PROFILE_UPDATED",
    category: "AUTH",
    ip: readIp(req.headers),
    metadata: { fields: Object.keys(data), sessionRotated: contactChanged },
  });

  // ── Session rotation on contact-channel change ───────────────
  // If email or phone was changed, rotate the current access token so a
  // previously-observed token can't be replayed to hijack the account
  // through the new (unverified) contact channel. Mirrors the password +
  // PIN change rotation pattern.
  let newSessionToken: string | undefined;
  if (contactChanged) {
    try {
      const cookieStore = await cookies();
      const rawToken = cookieStore.get("tp_session")?.value ?? "";
      const currentTokenHash = rawToken ? hashToken(rawToken) : null;
      if (currentTokenHash) {
        const currentSession = await db.session.findUnique({
          where: { tokenHash: currentTokenHash },
          select: { id: true, revokedAt: true },
        });
        if (currentSession && !currentSession.revokedAt) {
          newSessionToken = await regenerateAccessToken(currentSession.id);
        }
      }
    } catch {
      // Best-effort rotation — if it fails the profile was still updated.
    }
  }

  return json({
    data: {
      id: updated.id, fullName: updated.fullName, username: updated.username, email: updated.email,
      phone: updated.phone, avatarUrl: updated.avatarUrl, bio: updated.bio, role: updated.role,
      kycTier: updated.kycTier, kycStatus: updated.kycStatus,
      // Returned only when we rotated the access token. The client MUST
      // update its stored token — otherwise its next request would 401.
      ...(newSessionToken ? { sessionToken: newSessionToken } : {}),
    },
  });
}
