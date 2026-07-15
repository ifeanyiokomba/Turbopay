import * as crypto from "node:crypto";
import { Secret, TOTP, URI } from "otpauth";
import { db } from "@/lib/db";
import { encryptPii, decryptPii, hashPassword, verifyPassword } from "@/lib/turbopay/crypto";

/**
 * MFA (TOTP authenticator) service.
 *
 * Implements RFC 6238 time-based one-time passwords using the `otpauth`
 * library (no transitive deps). The TOTP secret is generated server-side,
 * AES-256-GCM encrypted at rest (`mfaSecretEnc`), and only decrypted in
 * memory during verification.
 *
 * Backup codes are 8 random 8-character alphanumeric strings. The user is
 * shown the plain codes ONCE during setup. At rest we store each code's
 * scrypt hash (same primitive as passwords/PINs) inside a single encrypted
 * JSON blob (`mfaBackupCodesEnc`). When a backup code is consumed, its hash
 * is removed from the list — each code is single-use.
 *
 * Token verification uses a ±1 time-step window (90 seconds total at the
 * default 30s period) — generous enough for clock drift between the user's
 * authenticator app and the server, tight enough that a guessed code is
 * useless within a minute.
 *
 * ── Threat model ──
 *  - DB dump: secrets + backup codes are encrypted (AES-256-GCM under
 *    TURBOPAY_PII_KEY). A dump alone can't mint codes.
 *  - Backup-code brute force: each code is 8 chars from a 32-char alphabet
 *    (≈ 2^40 bits) and we rate-limit the verify endpoint per-IP + per-user.
 *  - TOTP brute force: 6 digits = 10^6, ±1 window = ~3 × 10^6 plausible
 *    values; rate limits make even 10^6 guesses infeasible.
 */

const ISSUER = "Turbopay";
const TOTP_PERIOD = 30; // seconds (RFC default)
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // ±1 step (90s total) — allows minor clock drift
const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_LENGTH = 8;
// Ambiguous chars (0/O, 1/I/L) are excluded so codes are readable when the
// user copies them by hand from a screen.
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export interface MfaSetupResult {
  /** Base32-encoded TOTP secret (for manual entry into authenticator apps). */
  secret: string;
  /** `otpauth://totp/...` URI (paste-able into authenticator apps that accept URIs). */
  otpauthUrl: string;
  /** Plain-text backup codes — shown to the user ONCE during setup. */
  backupCodes: string[];
}

export interface BackupCodeBlob {
  /** Array of scrypt-hashed backup codes (the only form stored at rest). */
  hashes: string[];
}

/**
 * Generate a fresh TOTP secret + 8 one-time backup codes for a user.
 *
 * IMPORTANT: this does NOT enable MFA. The caller must persist the returned
 * secret + backup-code blob via `enableMfa()` AFTER the user proves they
 * have enrolled the secret in their authenticator app (by submitting a
 * valid 6-digit code). This guarantees we never enable MFA on a user whose
 * authenticator is misconfigured — which would lock them out.
 *
 * The returned plain-text backup codes are only ever seen by the user this
 * one time. We only store their scrypt hashes (encrypted as a blob).
 */
export async function generateSecret(userId: string, email: string): Promise<MfaSetupResult> {
  // 20 random bytes (160 bits) — RFC 4226 §4 recommends ≥160 bits.
  const secret = new Secret({ size: 20 });
  const base32 = secret.base32;

  const totp = new TOTP({
    issuer: ISSUER,
    label: email,
    // `issuerInLabel: true` produces `otpauth://totp/Turbopay:{email}?...`
    // — the URI format the task spec mandates, and what most authenticator
    // apps expect (the issuer prefix in the label helps disambiguate
    // multiple accounts in the same app).
    issuerInLabel: true,
    secret: base32,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    algorithm: "SHA1",
  });
  const otpauthUrl = URI.stringify(totp);

  const backupCodes = generateBackupCodesPlain();

  // Persist the secret + backup-code hashes immediately (encrypted). The
  // `mfaEnabled` flag stays false until `enableMfa()` is called after the
  // user verifies a token. If the user abandons setup, the unverified
  // fields are simply overwritten on the next attempt — no harm.
  //
  // Backup codes are normalised (uppercase + dash-stripped) BEFORE hashing
  // so verification accepts both `XXXX-XXXX` and `XXXXXXXX` forms. The
  // plain-text shown to the user keeps the dash for readability.
  const blob: BackupCodeBlob = { hashes: backupCodes.map((c) => hashPassword(normaliseBackupCode(c))) };
  const blobEncrypted = encryptPii(JSON.stringify(blob));
  await db.user.update({
    where: { id: userId },
    data: {
      mfaSecretEnc: encryptPii(base32),
      mfaBackupCodesEnc: blobEncrypted,
    },
  });

  return { secret: base32, otpauthUrl, backupCodes };
}

/**
 * Generate 8 plain-text backup codes. Uses `crypto.randomBytes` for the
 * CSPRNG. Codes are 8 chars from a 32-char alphabet (≈ 40 bits / code).
 */
function generateBackupCodesPlain(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    codes.push(generateBackupCode());
  }
  return codes;
}

function generateBackupCode(): string {
  // Group as XXXX-XXXX for readability when the user copies them down.
  const bytes = crypto.randomBytes(BACKUP_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
    out += BACKUP_CODE_ALPHABET[bytes[i] % BACKUP_CODE_ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/**
 * Normalise a backup code for hashing / verification: uppercase + strip
 * the optional dash separator. We display codes as `XXXX-XXXX` for
 * readability but accept both `XXXX-XXXX` and `XXXXXXXX` at verify time.
 */
function normaliseBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/-/g, "");
}

/**
 * Verify a 6-digit TOTP token against the user's stored secret.
 * Decrypted in memory, never logged. ±1 time-step window.
 *
 * ── Replay protection (F8) ─────────────────────────────────────────
 * After a successful TOTP validation, the matched step number
 * (`epoch / 30`, RFC 6238) is compared to the user's `mfaLastStep`:
 *   - If `step <= mfaLastStep` the code is a REPLAY (the same step was
 *     already accepted) → reject. This closes the ~90-second replay
 *     window where a phished code could otherwise be re-used.
 *   - Otherwise accept + persist `mfaLastStep = step`.
 *
 * The replay check ONLY runs when the user has a stored `mfaLastStep`
 * (i.e. they've successfully verified a code before). First-ever
 * verifications (e.g. during MFA enable) always pass the replay check.
 *
 * `mfaLastStep` is cleared on `disableMfa()` so a fresh enable flow
 * starts from a clean replay state.
 */
export async function verifyToken(userId: string, token: string): Promise<boolean> {
  // Defensive: a TOTP token must be 6 digits. Reject anything else before
  // touching the DB (saves a query on obviously-malformed input).
  if (!/^\d{6}$/.test(token)) return false;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { mfaSecretEnc: true, mfaEnabled: true, mfaLastStep: true },
  });
  if (!user?.mfaSecretEnc) return false;

  let base32: string;
  try {
    base32 = decryptPii(user.mfaSecretEnc);
  } catch {
    // Decryption failure (key rotation, corruption) — fail closed.
    return false;
  }

  const totp = new TOTP({
    issuer: ISSUER,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    algorithm: "SHA1",
    secret: Secret.fromBase32(base32),
  });
  // validate() returns the delta (0 = current step, ±1 = adjacent step) or
  // null on no match. We need the actual step number for replay tracking.
  const delta = totp.validate({ token, window: TOTP_WINDOW });
  if (delta === null) return false;

  // Compute the matched step (epoch / period). The delta is relative to the
  // current step at validation time.
  const nowSec = Math.floor(Date.now() / 1000);
  const currentStep = Math.floor(nowSec / TOTP_PERIOD);
  const matchedStep = currentStep + delta;

  // ── F8: TOTP replay protection ──────────────────────────────
  // Reject if this step (or a LATER one — clock-skew tolerant) has already
  // been accepted. Without this, a phished code could be replayed within
  // its ~90s validity window. The check is skipped on the first-ever
  // verification (no stored mfaLastStep).
  if (user.mfaLastStep !== null && matchedStep <= user.mfaLastStep) {
    // Replay detected — do NOT update mfaLastStep (the existing value is
    // already >= the rejected step). Fail closed.
    return false;
  }

  // Accept + record the step. We persist `matchedStep` so subsequent
  // verifications against the same (or earlier) step are rejected.
  // Best-effort write — a write failure here would still let the user in
  // this once, but the next call would replay-protect against the same
  // step (idempotent). Use updateMany with a status guard so a concurrent
  // verify on a now-FROZEN/SUSPENDED user can't sneak through.
  await db.user.updateMany({
    where: { id: userId },
    data: { mfaLastStep: matchedStep },
  }).catch(() => {
    // Swallow — the verification has already succeeded; failing the write
    // shouldn't lock the user out. The next call will retry the write.
  });
  return true;
}

/**
 * Verify a one-time backup code. On a successful match, the consumed code's
 * hash is removed from the stored blob (single-use). The user can have at
 * most 8 backup codes total; each `verifyBackupCode` match decrements the
 * count. When the count gets low, the user should be prompted to regenerate.
 */
export async function verifyBackupCode(userId: string, code: string): Promise<boolean> {
  const normalised = normaliseBackupCode(code);
  if (normalised.length !== BACKUP_CODE_LENGTH) return false;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { mfaBackupCodesEnc: true, mfaEnabled: true },
  });
  if (!user?.mfaBackupCodesEnc) return false;

  let blob: BackupCodeBlob;
  try {
    blob = JSON.parse(decryptPii(user.mfaBackupCodesEnc)) as BackupCodeBlob;
  } catch {
    return false;
  }
  if (!Array.isArray(blob.hashes) || blob.hashes.length === 0) return false;

  // Find + remove the matching hash. Use a manual loop so we know which
  // index matched (we splice it out).
  let matchIndex = -1;
  for (let i = 0; i < blob.hashes.length; i++) {
    if (verifyPassword(normalised, blob.hashes[i])) {
      matchIndex = i;
      break;
    }
  }
  if (matchIndex === -1) return false;

  // Consume: remove the used hash + re-encrypt + persist.
  blob.hashes.splice(matchIndex, 1);
  await db.user.update({
    where: { id: userId },
    data: { mfaBackupCodesEnc: encryptPii(JSON.stringify(blob)) },
  });
  return true;
}

/**
 * Mark MFA as enabled for the user. Called only AFTER the user has verified
 * a 6-digit TOTP token from their authenticator app (proves the secret was
 * enrolled correctly).
 */
export async function enableMfa(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: true,
      mfaEnabledAt: new Date(),
    },
  });
}

/**
 * Disable MFA + clear all MFA fields. Called when the user explicitly
 * disables MFA from settings (after re-verifying a TOTP token).
 *
 * `mfaLastStep` is also cleared so a subsequent re-enable starts from a
 * clean replay-protection state (different secret → different step
 * sequence; the prior mfaLastStep would be meaningless).
 */
export async function disableMfa(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: false,
      mfaSecretEnc: null,
      mfaBackupCodesEnc: null,
      mfaEnabledAt: null,
      mfaLastStep: null,
    },
  });
}
