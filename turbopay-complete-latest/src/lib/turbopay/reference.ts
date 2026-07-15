import * as crypto from "node:crypto";

/**
 * Cryptographically secure reference & account-number generation.
 *
 * Financial transaction references MUST be unguessable and unique —
 * predictable references enable reference-guessing attacks and reduce
 * idempotency-key entropy. We use crypto.randomBytes (CSPRNG), never
 * Math.random().
 *
 * Lives in its own module to avoid the circular dependency between
 * ledger.ts ↔ payments.ts ↔ money.ts that previously forced a bottom-of-file
 * import.
 */

const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I

/** Generate a human-friendly reference: TP-AB12CD34 */
export function generateReference(prefix = "TP"): string {
  const bytes = crypto.randomBytes(8);
  const s = Array.from(bytes)
    .map((b) => REF_CHARS[b % REF_CHARS.length])
    .join("");
  return `${prefix}-${s}`;
}

/** Generate a 10-digit NUBAN-style account number using a CSPRNG. */
export function generateAccountNumber(): string {
  // crypto.randomInt(0, 10) per digit gives a uniform 0-9 with no modulo bias.
  let s = "";
  for (let i = 0; i < 10; i++) s += crypto.randomInt(0, 10).toString();
  return s;
}
