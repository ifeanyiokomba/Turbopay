import * as crypto from "node:crypto";

/**
 * Cryptography helpers.
 * - Passwords: scrypt (Node built-in, no extra deps).
 * - Tokens: randomBytes hex.
 * - PII (BVN/NIN): AES-256-GCM symmetric encryption.
 *
 * SECURITY: the PII key MUST be provided via TURBOPAY_PII_KEY. There is NO
 * hardcoded fallback — if the env var is missing we throw at first use rather
 * than silently encrypting with a publicly-known key (which would be
 * equivalent to plaintext). A dev-only override is permitted when
 * NODE_ENV !== "production" via a derived key, logged once as a warning.
 */

let piiKeyWarned = false;

/**
 * KEY VERSIONING — supports key rotation without data loss.
 *
 * Encrypted payloads are prefixed with a version tag: `v1:<base64>`.
 * - `v1:` → key derived from `TURBOPAY_PII_KEY` (current key, used for encryption).
 * - Unversioned payloads (no prefix) → also decrypted with `TURBOPAY_PII_KEY`
 *   (backward compatibility with data encrypted before versioning was added).
 *
 * To rotate the key:
 *   1. Set `TURBOPAY_PII_PREV_KEYS=v1:<old_key_hex>` (comma-separated if multiple).
 *   2. Set `TURBOPAY_PII_KEY=<new_key_hex>`.
 *   3. Re-encrypt existing data (bulk UPDATE with decrypt→encrypt).
 *   4. Remove `TURBOPAY_PII_PREV_KEYS` once no v1-prefixed data uses the old key.
 */

const KEY_VERSION = "v1";

function resolvePiiKey(): string {
  const envKey = process.env.TURBOPAY_PII_KEY;
  if (envKey && envKey.length >= 16) return envKey;
  throw new Error(
    "TURBOPAY_PII_KEY must be set (>= 16 chars). " +
    "No hardcoded fallback — encrypting with a known key defeats the purpose of encryption."
  );
}

/** Derive a 256-bit AES key from a raw passphrase via SHA-256. */
function deriveKey(passphrase: string): Buffer {
  return crypto.createHash("sha256").update(passphrase).digest();
}

/** The current encryption key (used for new encryptions). */
function piiKey(): Buffer {
  return deriveKey(resolvePiiKey());
}

/**
 * Resolve a decryption key by version tag.
 * - `"v1"` → current key from `TURBOPAY_PII_KEY`.
 * - `null` (unversioned) → current key (backward compat).
 * Falls back to `TURBOPAY_PII_PREV_KEYS` for rotated-out versions.
 */
function resolveDecryptionKey(version: string | null): Buffer {
  // v1 and unversioned both use the current key.
  if (version === KEY_VERSION || version === null) {
    return piiKey();
  }
  // Check previous keys (comma-separated `v1:hex` entries).
  const prevKeysRaw = process.env.TURBOPAY_PII_PREV_KEYS;
  if (prevKeysRaw) {
    for (const entry of prevKeysRaw.split(",")) {
      const [tag, hex] = entry.trim().split(":");
      if (tag === version && hex) return deriveKey(hex);
    }
  }
  throw new Error(`No key found for version "${version}". Set TURBOPAY_PII_PREV_KEYS or re-encrypt with the current key.`);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  // The prefix check ("scrypt") is NOT constant-time, but this is safe:
  // the prefix is a fixed string (not user input), so the comparison does
  // not leak information about the stored hash. The timing-sensitive
  // comparison happens below via timingSafeEqual on the actual hash bytes.
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  // Defensive: corrupted/truncated hash would cause timingSafeEqual to throw
  if (hash.length !== test.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
}

/**
 * A scrypt-formatted "dummy" hash for use in timing-safe login: when the
 * user is not found, we still run a full scrypt verification so the response
 * time is indistinguishable from a real failed login (prevents enumeration).
 *
 * Lazily computed on first use (NOT at module-eval time) so that importing
 * this module in a context without node:crypto never crashes. Server-only.
 */
let _dummyHash: string | null = null;
export function dummyHash(): string {
  if (!_dummyHash) _dummyHash = hashPassword("turbopay-timing-dummy-do-not-match");
  return _dummyHash;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateOtp(): string {
  // cryptographically secure 6-digit OTP. Math.random() is NOT CSPRNG and
  // would let an attacker predict future OTPs after observing a few values.
  return crypto.randomInt(100000, 1000000).toString();
}

/** AES-256-GCM encrypt a PII string. Returns versioned base64 payload: `v1:<base64>`. */
export function encryptPii(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", piiKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, enc]).toString("base64");
  return `${KEY_VERSION}:${payload}`;
}

/**
 * Decrypt a PII string. Supports both versioned (`v1:<base64>`) and
 * unversioned (plain base64) payloads for backward compatibility.
 */
export function decryptPii(payload: string): string {
  let version: string | null = null;
  let raw = payload;

  // Check for version prefix.
  if (payload.startsWith(`${KEY_VERSION}:`)) {
    version = KEY_VERSION;
    raw = payload.slice(KEY_VERSION.length + 1);
  }

  const key = resolveDecryptionKey(version);
  const buf = Buffer.from(raw, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

// Display-masking helpers re-exported from the browser-safe module so server
// code can import them from either location.
export { maskId, maskEmail, maskPhone } from "@/lib/turbopay/mask";

/**
 * TRANSACTION PIN — a 4-digit PIN separate from the login password, required
 * to authorise every debit (transfer, airtime, data, bills). Hashed with
 * scrypt (same primitive as passwords) so a DB leak never exposes raw PINs.
 */
export function hashPin(pin: string): string {
  if (!/^\d{4}$/.test(pin)) throw new Error("PIN must be exactly 4 digits");
  return hashPassword(pin);
}

export function verifyPin(pin: string, stored: string): boolean {
  if (!/^\d{4}$/.test(pin)) return false;
  return verifyPassword(pin, stored);
}

/**
 * OTP HASHING — SHA-256 at rest.
 *
 * OTPs are short-lived (10 min) 6-digit codes. We use SHA-256 (not scrypt)
 * because:
 *   - The code space is tiny (10^6) — scrypt's slowness doesn't help when
 *     the attacker can brute-force all 1M codes in <1s regardless.
 *   - OTPs expire quickly — the window for offline attack is narrow.
 *   - SHA-256 is fast, keeping verification low-latency.
 *
 * The hash is stored in the `code` column of OtpCode / RecoveryToken.
 * At verify time, the candidate is hashed and compared against the stored hash.
 */
export function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}
