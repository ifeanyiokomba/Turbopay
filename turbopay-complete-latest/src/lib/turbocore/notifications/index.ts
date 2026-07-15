/**
 * TurboCore — Notification Framework
 * ===================================
 *
 * Channel-agnostic notification dispatch. Every notification attempt is
 * logged to the NotificationLog table for the admin notification center.
 *
 * Failed sends are marked `status = "FAILED"` and picked up by the
 * `retryFailed()` queue. After MAX_RETRIES failed retries the entry is
 * marked `PERMANENTLY_FAILED` so the queue stops attempting it. The cron
 * route `/api/cron/notification-retry` invokes `retryFailed(24)` on a
 * schedule (every 15 minutes).
 *
 * Usage:
 *   await notify.send({ to: phone, channel: "SMS", template: "transaction.debit", variables: { amount: 500 } });
 *   await notify.retryFailed(24); // re-attempt failures from the last 24h
 */

import { providers } from "@/lib/turbocore/providers/registry";
import { adapterFactory } from "@/lib/turbocore/providers/adapter-factory";
import { audit } from "@/lib/turbopay/audit";
import { db } from "@/lib/db";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";
import type { NotificationPayload, INotificationProvider } from "@/lib/turbocore/providers/interfaces";

/** Max retry attempts before a notification is abandoned. */
export const MAX_NOTIFICATION_RETRIES = 3;

export interface NotificationResult {
  delivered: boolean;
  messageId?: string;
  error?: string;
}

export interface RetryResult {
  retried: number; // total entries the queue considered
  succeeded: number; // entries that delivered on this run
  failed: number; // entries that failed on this run (incl. those marked permanent)
  permanentlyFailed: number; // subset of `failed` that crossed the retry threshold
}

/** Mask the recipient for logging — phone shows last 4, email hides domain. */
function maskRecipient(to: string, channel: string): string {
  if (channel === "EMAIL") return maskEmail(to);
  return maskPhone(to);
}

class NotificationService {
  /**
   * Send a notification with SMS-first priority.
   *
   * Priority order for SMS:
   *   1. GetOTP (otp.dev) — primary SMS provider
   *   2. Termii — SMS fallback
   *   3. Resend — cross-channel email fallback (if user has email)
   *
   * Priority order for EMAIL:
   *   1. Resend — primary email provider
   *   2. Termii — email fallback (via Termii's email channel)
   *   3. GetOTP — cross-channel SMS fallback (if user has phone)
   *
   * Every attempt is logged to NotificationLog. Failed entries are picked
   * up by `retryFailed()`.
   */
  async send(payload: NotificationPayload & { userId?: string }): Promise<NotificationResult> {
    // ─── Resolve providers by name for the fallback chain ──────
    const getProviderByName = async (name: string): Promise<INotificationProvider | null> => {
      const config = await db.providerConfig.findFirst({
        where: { providerName: name, contract: "notification", enabled: true },
      });
      if (!config) return null;
      const adapter = await adapterFactory.create("notification", config.id);
      return adapter as INotificationProvider | null;
    };

    const attempts: Array<{ notifier: INotificationProvider; channel: string }> = [];

    if (payload.channel === "SMS") {
      // SMS priority: GetOTP → Termii
      const getotp = await getProviderByName("otpdev");
      const termii = await getProviderByName("termii");
      if (getotp) attempts.push({ notifier: getotp, channel: "SMS" });
      if (termii) attempts.push({ notifier: termii, channel: "SMS" });
    } else if (payload.channel === "EMAIL") {
      // EMAIL priority: Resend → Termii
      const resend = await getProviderByName("resend");
      const termii = await getProviderByName("termii");
      if (resend) attempts.push({ notifier: resend, channel: "EMAIL" });
      if (termii) attempts.push({ notifier: termii, channel: "EMAIL" });
    }

    // If SMS was requested and fails, try email as fallback (if user has email).
    // If EMAIL was requested and fails, try SMS as fallback (if user has phone).
    const fallbackChannel = payload.channel === "SMS" ? "EMAIL" : "SMS";

    let lastResult: { ok: boolean; data?: { messageId?: string }; error?: { message?: string } } | null = null;
    let lastNotifier: any = null;

    for (const attempt of attempts) {
      let result: Awaited<ReturnType<typeof attempt.notifier.send>>;
      try {
        result = await attempt.notifier.send(payload);
      } catch (err) {
        result = {
          ok: false,
          error: {
            code: "PROVIDER_THREW",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }

      // Log this attempt.
      await this.logAttempt(payload, attempt.notifier.name, result);

      if (result.ok) {
        return { delivered: true, messageId: result.data?.messageId };
      }

      lastResult = result;
      lastNotifier = attempt.notifier;
    }

    // ─── Fallback: try the other channel ───────────────────────
    // If SMS was requested and failed, try email (if userId available to look up email).
    // If EMAIL was requested and failed, try SMS (if userId available to look up phone).
    if (payload.userId) {
      try {
        const user = await db.user.findUnique({
          where: { id: payload.userId },
          select: { email: true, phone: true },
        });

        if (user) {
          const fallbackTo = fallbackChannel === "EMAIL" ? user.email : user.phone;
          if (fallbackTo) {
            const fallbackNotifier = await providers.notification();
            const fallbackPayload: NotificationPayload = {
              ...payload,
              to: fallbackTo,
              channel: fallbackChannel as "SMS" | "EMAIL",
            };

            let fbResult: Awaited<ReturnType<typeof fallbackNotifier.send>>;
            try {
              fbResult = await fallbackNotifier.send(fallbackPayload);
            } catch (err) {
              fbResult = {
                ok: false,
                error: {
                  code: "PROVIDER_THREW",
                  message: err instanceof Error ? err.message : String(err),
                },
              };
            }

            await this.logAttempt(fallbackPayload, fallbackNotifier.name, fbResult);

            if (fbResult.ok) {
              return { delivered: true, messageId: fbResult.data?.messageId };
            }

            lastResult = fbResult;
            lastNotifier = fallbackNotifier;
          }
        }
      } catch {
        // Fallback lookup failure — continue with last result.
      }
    }

    // All attempts failed.
    if (lastNotifier) {
      await audit({
        action: "NOTIFICATION_FAILED",
        category: "WALLET",
        severity: "WARN",
        metadata: {
          to: maskRecipient(payload.to, payload.channel),
          channel: payload.channel,
          template: payload.template,
          error: lastResult?.error?.message,
        },
      });
    }

    return { delivered: false, error: lastResult?.error?.message ?? "All notification channels failed" };
  }

  /** Log a single notification attempt to NotificationLog. */
  private async logAttempt(
    payload: NotificationPayload & { userId?: string },
    providerName: string | undefined,
    result: { ok: boolean; data?: { messageId?: string }; error?: { message?: string } },
  ) {
    try {
      await db.notificationLog.create({
        data: {
          userId: (payload as any).userId ?? null,
          channel: payload.channel,
          recipient: maskRecipient(payload.to, payload.channel),
          template: payload.template,
          status: result.ok ? "SENT" : "FAILED",
          provider: providerName ?? null,
          messageId: result.data?.messageId ?? null,
          errorMsg: result.ok ? null : (result.error?.message ?? "unknown"),
          metadata: payload.variables ? JSON.stringify(payload.variables) : null,
          retryCount: 0,
        },
      });
    } catch {
      // Logging must never break the request flow.
    }
  }

  /**
   * Retry queue — re-attempt delivery of FAILED notifications created within
   * the last `maxAgeHours`. For each entry:
   *   - re-resolve the real recipient from the user row (the log stores a
   *     masked recipient, which cannot be re-dispatched)
   *   - call the provider again
   *   - on success: mark SENT, increment retryCount
   *   - on failure: increment retryCount; if retryCount >= MAX_NOTIFICATION_RETRIES
   *     (i.e. ≥ 3), mark PERMANENTLY_FAILED so the queue stops attempting it
   *
   * Returns a summary so the caller (cron route / admin tooling) can report
   * or alert on the outcome.
   */
  async retryFailed(maxAgeHours = 24): Promise<RetryResult> {
    const since = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

    // Pull FAILED notifications that haven't exhausted retries.
    const failed = await db.notificationLog.findMany({
      where: {
        status: "FAILED",
        createdAt: { gte: since },
        retryCount: { lt: MAX_NOTIFICATION_RETRIES },
        userId: { not: null },
      },
      include: { user: true },
      take: 100,
      orderBy: { createdAt: "asc" },
    });

    let succeeded = 0;
    let failedCount = 0;
    let permanentlyFailed = 0;

    const notifier = await providers.notification();

    for (const log of failed) {
      // Resolve real recipient from the user (NotificationLog stores masked).
      let recipient: string | null = null;
      if (log.user) {
        if (log.channel === "EMAIL") recipient = log.user.email;
        else if (log.channel === "SMS") recipient = log.user.phone;
      }
      if (!recipient) {
        // Cannot retry without a real recipient — mark permanent.
        await db.notificationLog.update({
          where: { id: log.id },
          data: {
            status: "PERMANENTLY_FAILED",
            retryCount: { increment: 1 },
            errorMsg: "no_resolvable_recipient",
          },
        });
        failedCount++;
        permanentlyFailed++;
        continue;
      }

      const variables = log.metadata
        ? (JSON.parse(log.metadata) as Record<string, string | number>)
        : {};

      // Re-attempt delivery. Treat a throw as a failure.
      let result: Awaited<ReturnType<typeof notifier.send>>;
      try {
        result = await notifier.send({
          to: recipient,
          channel: log.channel as "SMS" | "EMAIL" | "PUSH",
          template: log.template,
          variables,
        });
      } catch (err) {
        result = {
          ok: false,
          error: {
            code: "PROVIDER_THREW",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }

      if (result.ok) {
        await db.notificationLog.update({
          where: { id: log.id },
          data: {
            status: "SENT",
            retryCount: { increment: 1 },
            messageId: result.data?.messageId ?? null,
            errorMsg: null,
          },
        });
        succeeded++;
      } else {
        const newRetryCount = log.retryCount + 1;
        const isPermanent = newRetryCount >= MAX_NOTIFICATION_RETRIES;
        await db.notificationLog.update({
          where: { id: log.id },
          data: {
            status: isPermanent ? "PERMANENTLY_FAILED" : "FAILED",
            retryCount: { increment: 1 },
            errorMsg: result.error?.message ?? "unknown",
          },
        });
        failedCount++;
        if (isPermanent) permanentlyFailed++;
      }
    }

    return {
      retried: failed.length,
      succeeded,
      failed: failedCount,
      permanentlyFailed,
    };
  }

  /** Convenience: send a transaction debit SMS. */
  async sendTransactionDebitSms(
    phone: string,
    vars: { amount: string; reference: string; balance: string },
    userId?: string,
  ) {
    return this.send({ to: phone, channel: "SMS", template: "transaction.debit", variables: vars, userId });
  }

  /** Convenience: send a transaction credit SMS. */
  async sendTransactionCreditSms(
    phone: string,
    vars: { amount: string; reference: string; sender: string },
    userId?: string,
  ) {
    return this.send({ to: phone, channel: "SMS", template: "transaction.credit", variables: vars, userId });
  }

  /**
   * Create an in-app notification for a user. This is the primary notification
   * channel for transaction alerts — it shows in the notification bell dialog.
   * Fire-and-forget: never blocks the caller, never throws.
   */
  async sendInApp(opts: {
    userId: string;
    type: "TRANSACTION" | "SECURITY" | "KYC" | "SUPPORT" | "PROMOTIONAL" | "SYSTEM" | "DISPUTE" | "REFERRAL";
    title: string;
    message: string;
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    actionUrl?: string;
    actionLabel?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await db.inAppNotification.create({
        data: {
          userId: opts.userId,
          type: opts.type,
          title: opts.title,
          message: opts.message,
          priority: opts.priority ?? "NORMAL",
          actionUrl: opts.actionUrl ?? null,
          actionLabel: opts.actionLabel ?? null,
          metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
        },
      });
    } catch {
      // Never let notification creation break the transaction flow.
    }
  }

  /**
   * Broadcast an announcement to ALL users (admin-initiated). Creates an
   * in-app notification for every active user. Used for platform-wide
   * announcements like maintenance windows, new features, etc.
   */
  async broadcastAnnouncement(opts: {
    title: string;
    message: string;
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    actionUrl?: string;
    actionLabel?: string;
  }): Promise<{ sent: number }> {
    const users = await db.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    const priority = opts.priority ?? "NORMAL";
    // Batch-create all notifications
    await db.inAppNotification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: "SYSTEM" as const,
        title: opts.title,
        message: opts.message,
        priority,
        actionUrl: opts.actionUrl ?? null,
        actionLabel: opts.actionLabel ?? null,
      })),
    });
    return { sent: users.length };
  }
}

export const notify = new NotificationService();
