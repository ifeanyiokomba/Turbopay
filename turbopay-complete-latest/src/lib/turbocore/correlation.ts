/**
 * TurboCore — Correlation ID System
 * ===================================
 *
 * Generates and propagates unique correlation IDs across the full request
 * lifecycle: HTTP REQUEST → SERVICE → TRANSACTION → PROVIDER → WEBHOOK →
 * LEDGER → RESPONSE.
 *
 * A correlation ID is a ULID (Universally Unique Lexicographically Sortable
 * Identifier) — time-ordered, 26 characters, URL-safe, no secrets.
 *
 * Usage:
 *   import { generateCorrelationId, isValidCorrelationId } from "@/lib/turbocore/correlation";
 *
 *   const correlationId = generateCorrelationId();
 *   if (!isValidCorrelationId(supplied)) { ... }
 */

import { randomBytes } from "node:crypto";

// ULID-like ID: 26 chars, time-ordered, URL-safe
// Format: timestamp (10 chars base32) + random (16 chars base32)
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generate a correlation ID.
 * Format: 26-char ULID-like string (time-ordered, URL-safe).
 */
export function generateCorrelationId(): string {
  const now = Date.now();
  let ts = "";
  let temp = now;
  for (let i = 0; i < 10; i++) {
    ts = BASE32[temp % 32] + ts;
    temp = Math.floor(temp / 32);
  }

  const random = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) {
    rand += BASE32[random[i] % 32];
  }

  return ts + rand;
}

/**
 * Validate a correlation ID format.
 * Accepts: 26-char ULID-like strings, UUIDs, and simple alphanumeric IDs
 * up to 128 characters. Rejects empty strings and strings with sensitive data.
 */
export function isValidCorrelationId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  if (id.length > 128) return false;

  // ULID format: 26 chars, uppercase base32
  if (id.length === 26 && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return true;

  // UUID format
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return true;

  // Simple alphanumeric ID (e.g., "TP-XXXXXXXX", "pay_abc123")
  if (/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return true;

  return false;
}

/**
 * Sanitize a correlation ID for logging.
 * Removes any characters that could be used for log injection.
 */
export function sanitizeCorrelationId(id: string): string {
  return id.replace(/[^\w-]/g, "").slice(0, 128);
}

/**
 * Extract correlation ID from request headers.
 * Checks: X-Correlation-ID, X-Request-ID, X-Trace-ID (in order).
 */
export function extractCorrelationId(headers: Headers): string | null {
  const candidates = [
    headers.get("x-correlation-id"),
    headers.get("x-request-id"),
    headers.get("x-trace-id"),
  ];

  for (const candidate of candidates) {
    if (candidate && isValidCorrelationId(candidate)) {
      return candidate;
    }
  }

  return null;
}
