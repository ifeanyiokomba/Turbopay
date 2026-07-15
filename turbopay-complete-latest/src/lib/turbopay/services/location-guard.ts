/**
 * Turbopay Service Layer — Location Guard.
 * =========================================
 *
 * When a user opts in to the Location Guard, the debit pipeline checks
 * whether the current request IP is in a /24 subnet the user has
 * previously transacted from (any Device row whose stored IP falls in
 * that subnet). If not, the pipeline throws `StepUpRequiredError`
 * (HTTP 403) so the client can prompt for a step-up OTP via
 * `/api/security/large-tx-step-up` (reusing the existing step-up
 * infrastructure) and retry the original debit.
 *
 * The guard plugs into `debitPipeline` AFTER the Large Transaction Shield
 * and BEFORE the AML check. It is OFF by default (`locationGuardEnabled =
 * false`) — users opt in via Settings → Security → Location Guard.
 *
 * Subnet extraction: only IPv4 is supported (matches the existing device
 * fingerprint logic in `@/lib/turbocore/security`). An IPv6 address or an
 * empty IP is treated as "unknown location" — the guard returns
 * `{ isNewLocation: true }` for those so step-up fires (defensive: never
 * silently allow an unrecognised address format).
 *
 * Why the Device table: the `Device` model stores the IP of the most
 * recent login from each (UA + /24 subnet) fingerprint pair. After a
 * successful login, that subnet becomes "known". Subsequent transactions
 * from the same subnet are allowed through; transactions from a new
 * subnet trigger step-up. This matches the spec exactly: "Check if the
 * user has any Device records with an IP in this subnet".
 */

import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";

export interface LocationCheck {
  /** True if no Device row exists with an IP in the request's /24 subnet. */
  isNewLocation: boolean;
  /** The /24 subnet of the request IP (e.g. "197.210.45"), or null for IPv6/unknown. */
  subnet: string | null;
}

export interface StepUpRequirement {
  required: boolean;
  reason?: string;
  /** The /24 subnet that triggered step-up (for client display / audit). */
  subnet?: string | null;
}

class LocationGuardService {
  /**
   * Check if the current IP is in a known subnet for this user.
   *
   *   1. Extract the /24 subnet from the IP (e.g. "197.210.45.12" → "197.210.45").
   *   2. Check if the user has any Device records with an IP in this subnet
   *      (the Device model already stores IP — use it).
   *   3. If no device in this subnet → { isNewLocation: true, subnet }.
   *   4. If device exists in this subnet → { isNewLocation: false, subnet }.
   *
   * Defensive: an empty IP, an IPv6 address, or any non-dotted-quad string
   * is treated as "unknown location" → `{ isNewLocation: true, subnet: null }`.
   * This is intentional — never silently allow an unrecognised address format.
   */
  async checkLocation(userId: string, ip: string): Promise<LocationCheck> {
    const subnet = extractSubnet(ip);
    if (!subnet) {
      // Unrecognised address format (IPv6, empty, malformed) — defensive.
      return { isNewLocation: true, subnet: null };
    }

    // Match any Device row whose stored IP starts with "<subnet>." — i.e. the
    // first three octets match. SQLite handles `startsWith` via a string
    // prefix scan. A trailing "." in the prefix avoids false matches like
    // "197.210.45" matching "197.210.456.x" (which can't happen with valid
    // dotted-quad IPs but is a defensive guard).
    const known = await db.device.findFirst({
      where: {
        userId,
        ip: { startsWith: `${subnet}.` },
      },
      select: { id: true },
    });

    return {
      isNewLocation: !known,
      subnet,
    };
  }

  /**
   * Check if step-up is required for this transaction.
   *
   *   1. Load user's `locationGuardEnabled`.
   *   2. If disabled → return { required: false }.
   *   3. Call checkLocation(userId, ip).
   *   4. If isNewLocation → return { required: true, reason: "New location detected" }.
   *   5. Otherwise → return { required: false }.
   *
   * If the user row doesn't exist (shouldn't happen — the pipeline already
   * authenticated the user), the guard is treated as disabled (safe default
   * — the pipeline's PIN + AML checks still apply).
   */
  async requiresStepUp(userId: string, ip: string): Promise<StepUpRequirement> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { locationGuardEnabled: true },
    });
    if (!user || !user.locationGuardEnabled) {
      return { required: false };
    }

    const loc = await this.checkLocation(userId, ip);
    if (loc.isNewLocation) {
      return {
        required: true,
        reason: "New location detected. Please verify your identity.",
        subnet: loc.subnet,
      };
    }
    return { required: false, subnet: loc.subnet };
  }

  /**
   * Read the user's current Location Guard configuration (for the Settings UI).
   */
  async getConfig(userId: string): Promise<{ enabled: boolean }> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { locationGuardEnabled: true },
    });
    return { enabled: user?.locationGuardEnabled ?? false };
  }

  /**
   * Update the user's Location Guard configuration.
   *
   * Audits the change so the user's security timeline reflects when the
   * guard was enabled / disabled.
   */
  async configure(
    userId: string,
    enabled: boolean,
  ): Promise<{ enabled: boolean }> {
    const updated = await db.user.update({
      where: { id: userId },
      data: { locationGuardEnabled: enabled },
      select: { locationGuardEnabled: true },
    });

    await audit({
      userId,
      action: "LOCATION_GUARD_CONFIGURED",
      category: "AML",
      metadata: { enabled: updated.locationGuardEnabled },
    }).catch(() => null);

    return { enabled: updated.locationGuardEnabled };
  }
}

/**
 * Extract the /24 subnet from an IPv4 address.
 *   "197.210.45.12" → "197.210.45"
 *   ""              → null  (defensive)
 *   "::1" (IPv6)    → null  (IPv6 unsupported — defensive)
 *   "garbage"       → null
 */
export function extractSubnet(ip: string): string | null {
  if (!ip || typeof ip !== "string") return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".");
  // IPv4 dotted-quad: exactly 4 numeric octets, each 0-255.
  if (parts.length !== 4) return null;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  }
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

export const locationGuard = new LocationGuardService();
