import { db } from "@/lib/db";
import { verifyPin } from "@/lib/turbopay/crypto";
import { audit } from "@/lib/turbopay/audit";
import type { SessionUser } from "@/lib/turbopay/types";

/**
 * TRANSACTION PIN VERIFICATION — with brute-force lockout.
 *
 * Every debit (transfer, airtime, data, bills) MUST call this with the
 * user-supplied PIN before touching the wallet. A stolen session cookie is
 * not enough to move money — the attacker also needs the 4-digit PIN.
 *
 * Brute-force protection:
 *  - After 5 consecutive failures, the PIN is locked for 15 minutes.
 *  - The lockout is enforced server-side via pinLockedUntil on the User row.
 *  - A per-user rate limit (10/min) is applied by the calling route BEFORE
 *    this function is reached.
 *
 * Returns { ok: true } on success, or { ok: false, error, code } on failure.
 */
export interface PinVerifyResult {
  ok: boolean;
  error?: string;
  code?: string;
}

const PIN_LOCK_THRESHOLD = 5;
const PIN_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function verifyTransactionPin(user: SessionUser, pin: string | undefined): Promise<PinVerifyResult> {
  if (!pin) return { ok: false, error: "Transaction PIN is required", code: "PIN_REQUIRED" };
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: "PIN must be 4 digits", code: "PIN_INVALID_FORMAT" };

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { transactionPinHash: true, pinFailCount: true, pinLockedUntil: true },
  });
  if (!dbUser?.transactionPinHash) {
    return { ok: false, error: "No transaction PIN set. Please set one in Settings.", code: "PIN_NOT_SET" };
  }

  // Check lockout BEFORE verifying the hash.
  if (dbUser.pinLockedUntil && dbUser.pinLockedUntil > new Date()) {
    return {
      ok: false,
      error: "PIN locked for 15 minutes. Too many failed attempts.",
      code: "PIN_LOCKED",
    };
  }

  const valid = verifyPin(pin, dbUser.transactionPinHash);
  if (!valid) {
    // Increment failure counter; lock at threshold.
    const newCount = (dbUser.pinFailCount ?? 0) + 1;
    const locked = newCount >= PIN_LOCK_THRESHOLD;
    await db.user.update({
      where: { id: user.id },
      data: {
        pinFailCount: newCount,
        ...(locked ? { pinLockedUntil: new Date(Date.now() + PIN_LOCK_DURATION_MS) } : {}),
      },
    });
    await audit({
      userId: user.id,
      action: "TRANSACTION_PIN_FAILED",
      category: "AUTH",
      severity: locked ? "WARN" : "INFO",
      metadata: { failCount: newCount, locked },
    });
    if (locked) {
      return {
        ok: false,
        error: "PIN locked for 15 minutes. Too many failed attempts.",
        code: "PIN_LOCKED",
      };
    }
    return { ok: false, error: "Incorrect transaction PIN", code: "INVALID_PIN" };
  }

  // Success — reset the failure counter.
  if (dbUser.pinFailCount > 0 || dbUser.pinLockedUntil) {
    await db.user.update({
      where: { id: user.id },
      data: { pinFailCount: 0, pinLockedUntil: null },
    });
  }
  return { ok: true };
}
