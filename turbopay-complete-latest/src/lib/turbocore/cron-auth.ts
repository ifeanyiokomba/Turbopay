import * as crypto from "node:crypto";

/**
 * Timing-safe comparison for cron secrets.
 *
 * JavaScript's `!==` short-circuits on the first differing character,
 * leaking timing information. This helper pads both buffers to equal
 * length so `timingSafeEqual` never throws and always compares all bytes.
 */
export function verifyCronSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Compare against a same-length copy of `b` so timingSafeEqual doesn't throw.
    // The length mismatch alone isn't enough to reject — we still run the
    // comparison to keep timing constant.
    const padded = Buffer.alloc(a.length, 0);
    b.copy(padded, 0, 0, Math.min(b.length, a.length));
    return crypto.timingSafeEqual(a, padded) && false;
  }
  return crypto.timingSafeEqual(a, b);
}
