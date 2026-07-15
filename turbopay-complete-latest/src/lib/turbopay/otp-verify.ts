import { timingSafeEqual } from "crypto";

/**
 * TIMING-SAFE OTP VERIFICATION
 *
 * Compares two OTP strings using constant-time comparison to prevent
 * timing attacks. An attacker measuring response times cannot determine
 * how many characters of the OTP matched.
 *
 * Both strings are converted to Buffers of equal length (padded with
 * zero bytes) before comparison to ensure the comparison is truly
 * constant-time regardless of input length.
 */
export function verifyOtp(candidate: string, stored: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(stored);

  // If lengths differ, still do the comparison (constant-time)
  // but the result will be false due to padding differences.
  if (a.length !== b.length) {
    // Pad the shorter buffer so timingSafeEqual doesn't throw
    const maxLen = Math.max(a.length, b.length);
    const aPadded = Buffer.alloc(maxLen, 0);
    const bPadded = Buffer.alloc(maxLen, 0);
    a.copy(aPadded);
    b.copy(bPadded);
    return timingSafeEqual(aPadded, bPadded) && a.length === b.length;
  }

  return timingSafeEqual(a, b);
}
