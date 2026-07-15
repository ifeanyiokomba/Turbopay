import { db } from "@/lib/db";
import { requireUser, readIp } from "@/lib/turbopay/auth";
import {
  generateSecret,
  verifyToken,
  verifyBackupCode,
  enableMfa,
  disableMfa,
} from "@/lib/turbopay/mfa";
import { verifyPassword } from "@/lib/turbopay/crypto";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { z } from "zod";

/**
 * MFA management route — setup, enable, disable.
 *
 * GET  (authed):  returns the user's MFA status (no secrets ever exposed).
 * POST (authed):  action-based —
 *   { action: "setup" }              → generates a new TOTP secret + 8 backup
 *                                       codes. MFA is NOT yet enabled; the
 *                                       caller must follow up with
 *                                       `enable` + a 6-digit code from the
 *                                       user's authenticator app.
 *   { action: "enable", token }      → verifies the TOTP token, enables MFA.
 *   { action: "disable", token }     → verifies the TOTP token, disables MFA.
 *
 * The `setup` action returns plain-text backup codes — they are shown to
 * the user ONCE. The server only stores their scrypt hashes (encrypted).
 *
 * The `disable` action also accepts a backup code as the `token` value —
 * critical for last-resort recovery if the user loses their authenticator
 * device (otherwise losing the device = permanent account lockout).
 */

const setupSchema = z.object({ action: z.literal("setup") });
const enableSchema = z.object({ action: z.literal("enable"), token: z.string().regex(/^\d{6}$/, "Enter a 6-digit code") });
// The `disable` action accepts EITHER a 6-digit TOTP code OR an 8-char
// backup code (XXXX-XXXX). Backup-code support is the last-resort recovery
// path: a user who lost their authenticator device can still disable MFA
// with a saved backup code (otherwise losing the device = permanent
// account lockout). We validate loosely here and let the handler decide
// which verification path to take based on the format.
const disableSchema = z.object({
  action: z.literal("disable"),
  token: z.string().min(4, "Enter a code").max(20, "Enter a code"),
  password: z.string().min(1, "Enter your password to disable MFA"),
});
const postSchema = z.discriminatedUnion("action", [setupSchema, enableSchema, disableSchema]);

export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { mfaEnabled: true, mfaEnabledAt: true, mfaBackupCodesEnc: true },
  });
  return json({
    data: {
      enabled: !!dbUser?.mfaEnabled,
      enabledAt: dbUser?.mfaEnabledAt?.toISOString() ?? null,
      // Whether the user still has backup codes stored. We never expose the
      // codes themselves — only a boolean so the UI can prompt to regenerate
      // when they're depleted.
      hasBackupCodes: !!dbUser?.mfaBackupCodesEnc,
    },
  });
}

export async function POST(req: Request) {
  // Rate-limit all MFA mutations — a tight window on `disable`/`enable`
  // defends against a stolen access token being used to brute-force the
  // 6-digit TOTP confirmation. 10/min/IP is generous for a human typing
  // codes; tight enough to block scripted guessing (10^6 / 6-digit space).
  const limited = await rateLimit(req, { key: "mfa-mutate", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid request body", 400); }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  const ip = readIp(req.headers);

  if (parsed.data.action === "setup") {
    // Don't allow re-setup while MFA is already enabled — the user must
    // disable first (which requires the current TOTP code). This prevents
    // an attacker with a stolen access token from silently swapping the
    // TOTP secret to lock the real user out.
    const existing = await db.user.findUnique({ where: { id: user.id }, select: { mfaEnabled: true } });
    if (existing?.mfaEnabled) {
      return errorJson("MFA is already enabled. Disable it first to set up a new secret.", 400, "MFA_ALREADY_ENABLED");
    }
    const setup = await generateSecret(user.id, user.email ?? user.phone ?? "unknown");
    await audit({
      userId: user.id,
      action: "MFA_SETUP_INITIATED",
      category: "AUTH",
      ip,
      metadata: {},
    });
    // Return secret + otpauthUrl + plain-text backup codes. The client
    // shows the QR/URL + codes; the user enters the 6-digit code from
    // their authenticator app to confirm + call `enable`.
    return json({ data: setup });
  }

  if (parsed.data.action === "enable") {
    // The user must have called `setup` first (which persists the secret
    // in disabled state). Verify the submitted 6-digit code against that
    // secret, then flip `mfaEnabled` on.
    const ok = await verifyToken(user.id, parsed.data.token);
    if (!ok) {
      await audit({ userId: user.id, action: "MFA_ENABLE_FAILED", category: "AUTH", severity: "WARN", ip });
      return errorJson("Invalid verification code", 400, "INVALID_MFA_TOKEN");
    }
    await enableMfa(user.id);
    await audit({ userId: user.id, action: "MFA_ENABLED", category: "AUTH", severity: "WARN", ip });
    return json({ data: { ok: true, enabled: true } });
  }

  // action === "disable"
  // Require password re-authentication before disabling MFA. This prevents
  // a session hijacker from disabling MFA with just a TOTP code.
  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!dbUser?.passwordHash) {
    return errorJson("No password set on this account. Contact support.", 400, "NO_PASSWORD");
  }
  const pwOk = verifyPassword(parsed.data.password, dbUser.passwordHash);
  if (!pwOk) {
    await audit({ userId: user.id, action: "MFA_DISABLE_FAILED", category: "AUTH", severity: "WARN", ip });
    return errorJson("Incorrect password", 401, "INVALID_PASSWORD");
  }

  // Then verify the TOTP token or backup code.
  const token = parsed.data.token;
  let ok = false;
  if (/^\d{6}$/.test(token)) {
    ok = await verifyToken(user.id, token);
  }
  if (!ok) {
    const backupOk = await verifyBackupCode(user.id, token);
    if (!backupOk) {
      await audit({ userId: user.id, action: "MFA_DISABLE_FAILED", category: "AUTH", severity: "WARN", ip });
      return errorJson("Invalid verification code", 400, "INVALID_MFA_TOKEN");
    }
  }
  await disableMfa(user.id);
  await audit({ userId: user.id, action: "MFA_DISABLED", category: "AUTH", severity: "WARN", ip });
  return json({ data: { ok: true, enabled: false } });
}
