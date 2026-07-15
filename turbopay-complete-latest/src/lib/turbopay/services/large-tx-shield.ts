/**
 * Turbopay Service Layer — Large Transaction Shield.
 * ==================================================
 *
 * When a user opts in to the Large Transaction Shield, any debit whose
 * amount (kobo) is at or above their configured threshold requires a
 * step-up OTP before the pipeline proceeds.
 *
 * The shield plugs into the debit pipeline AFTER PIN verification but
 * BEFORE the AML check. If the shield fires, the pipeline throws
 * `StepUpRequiredError` (HTTP 403) — the client then:
 *   1. Prompts the user for an OTP (initiated via this service's
 *      `initiateStepUp`, surfaced through `/api/security/large-tx-step-up`).
 *   2. Verifies the OTP via `verifyStepUp`.
 *   3. Retries the original debit request.
 *
 * The shield is OFF by default (`largeTxShieldEnabled = false`), so the
 * existing flow + tests are unaffected. Users opt in via Settings →
 * Security → Large Transaction Shield (settings.tsx).
 *
 * The OTP infrastructure reuses the existing `requireStepUp` / `verifyStepUp`
 * helpers from `@/lib/turbocore/security` — no new OTP plumbing was
 * introduced. The OTP is recorded as a `RecoveryToken(purpose="STEP_UP")`
 * row, valid for 5 minutes (per the security service's STEP_UP_TTL_MS).
 */

import { db } from "@/lib/db";
import {
  requireStepUp,
  verifyStepUp,
  recordSecurityEvent,
} from "@/lib/turbocore/security";
import { audit } from "@/lib/turbopay/audit";

/** Default threshold if the user hasn't customised it (mirrors schema default). */
export const DEFAULT_LARGE_TX_THRESHOLD_KOBO = 100_000; // ₦1,000

export interface StepUpRequirement {
  required: boolean;
  reason?: string;
  /** The user's configured threshold (kobo). Returned for client display. */
  thresholdKobo?: number;
}

export interface InitiateStepUpResult {
  /** OTP returned in dev/sandbox for the notification mock. Omitted in prod. */
  otp?: string;
  expiresAt: Date;
}

class LargeTxShieldService {
  /**
   * Check if a transaction requires step-up verification.
   *
   *   1. Load the user's `largeTxShieldEnabled` + `largeTxThresholdKobo`.
   *   2. If shield is disabled → return { required: false }.
   *   3. If amountKobo >= threshold → return { required: true, reason: "..." }.
   *   4. Otherwise → return { required: false }.
   *
   * If the user row doesn't exist (shouldn't happen — the pipeline already
   * authenticated the user), the shield is treated as disabled (safe default
   * — the pipeline's PIN + AML checks still apply).
   */
  async requiresStepUp(
    userId: string,
    amountKobo: number,
  ): Promise<StepUpRequirement> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { largeTxShieldEnabled: true, largeTxThresholdKobo: true },
    });
    if (!user || !user.largeTxShieldEnabled) {
      return { required: false };
    }
    const threshold = user.largeTxThresholdKobo ?? DEFAULT_LARGE_TX_THRESHOLD_KOBO;
    if (amountKobo >= threshold) {
      return {
        required: true,
        reason: "Amount exceeds your large transaction threshold",
        thresholdKobo: threshold,
      };
    }
    return { required: false, thresholdKobo: threshold };
  }

  /**
   * Initiate step-up verification — sends (records) an OTP for the user.
   * Reuses `requireStepUp` from the security service so the OTP lifecycle
   * (5-minute TTL, single-use, consumed on verify) is identical to the
   * existing step-up flow used by the Security Center.
   *
   * The OTP is returned to the caller in dev/sandbox (so the notification
   * mock can display it). In production the OTP is delivered via SMS/email
   * and the caller SHOULD NOT return it to the client — the API route
   * handles that gating.
   *
   * Records a `STEP_UP_REQUIRED` security event with the amount so the
   * user's security timeline shows when step-up was triggered for a
   * high-value transaction.
   */
  async initiateStepUp(
    userId: string,
    amountKobo: number,
  ): Promise<InitiateStepUpResult> {
    const { otp, expiresAt } = await requireStepUp(
      userId,
      `large_tx_shield:${amountKobo}`,
    );
    await recordSecurityEvent(userId, "STEP_UP_REQUIRED", {
      reason: "large_tx_shield",
      amountKobo,
    });
    await audit({
      userId,
      action: "LARGE_TX_STEP_UP_INITIATED",
      category: "AML",
      metadata: { amountKobo },
    }).catch(() => null);
    return { otp, expiresAt };
  }

  /**
   * Verify a step-up OTP. Returns true on success, false on invalid/expired.
   * On success, records a `STEP_UP_PASSED` security event so the timeline
   * reflects the completed challenge.
   */
  async verifyStepUp(userId: string, otp: string): Promise<boolean> {
    const ok = await verifyStepUp(userId, otp);
    if (ok) {
      await audit({
        userId,
        action: "LARGE_TX_STEP_UP_PASSED",
        category: "AML",
      }).catch(() => null);
    }
    return ok;
  }

  /**
   * Update the user's shield configuration. Used by the Settings UI
   * (settings.tsx → /api/profile or a dedicated route). Kept here so the
   * service is the single business-logic surface for the shield.
   *
   *   - `enabled` toggles the shield on/off.
   *   - `thresholdKobo` (optional) sets a new threshold. Must be a positive
   *     integer; clamped to a sane minimum (₦100 = 10_000 kobo) to prevent
   *     a misconfiguration that would trigger step-up on every micro-debit.
   */
  async configure(
    userId: string,
    opts: { enabled: boolean; thresholdKobo?: number },
  ): Promise<{ enabled: boolean; thresholdKobo: number }> {
    const data: { largeTxShieldEnabled: boolean; largeTxThresholdKobo?: number } = {
      largeTxShieldEnabled: opts.enabled,
    };
    if (opts.thresholdKobo !== undefined) {
      if (!Number.isInteger(opts.thresholdKobo) || opts.thresholdKobo < 10_000) {
        throw new Error("thresholdKobo must be a positive integer >= 10_000 (₦100)");
      }
      data.largeTxThresholdKobo = opts.thresholdKobo;
    }

    const updated = await db.user.update({
      where: { id: userId },
      data,
      select: { largeTxShieldEnabled: true, largeTxThresholdKobo: true },
    });

    await audit({
      userId,
      action: "LARGE_TX_SHIELD_CONFIGURED",
      category: "AML",
      metadata: {
        enabled: updated.largeTxShieldEnabled,
        thresholdKobo: updated.largeTxThresholdKobo,
      },
    }).catch(() => null);

    return {
      enabled: updated.largeTxShieldEnabled,
      thresholdKobo: updated.largeTxThresholdKobo,
    };
  }

  /** Read the user's current shield configuration (for the Settings UI). */
  async getConfig(
    userId: string,
  ): Promise<{ enabled: boolean; thresholdKobo: number }> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { largeTxShieldEnabled: true, largeTxThresholdKobo: true },
    });
    return {
      enabled: user?.largeTxShieldEnabled ?? false,
      thresholdKobo: user?.largeTxThresholdKobo ?? DEFAULT_LARGE_TX_THRESHOLD_KOBO,
    };
  }
}

export const largeTxShield = new LargeTxShieldService();
