import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { notify, MAX_NOTIFICATION_RETRIES } from "@/lib/turbocore/notifications";
import { providers } from "@/lib/turbocore/providers/registry";
import type { INotificationProvider, NotificationPayload, ProviderResult } from "@/lib/turbocore/providers/interfaces";

/**
 * Notification retry-queue tests — verify the FAILED→SENT retry path and the
 * PERMANENTLY_FAILED escalation after MAX_NOTIFICATION_RETRIES failed retries.
 *
 * Strategy: `vi.spyOn(providers, "notification")` swaps the resolver so the
 * notify service picks up a controllable fake provider. This is the same
 * `providers` object the notify module imports, so the swap propagates.
 */

let testUserId: string;
let testPhone: string;
let testEmail: string;

/** Build a controllable fake notification provider. */
function makeFakeProvider(opts: { ok: boolean; errorMessage?: string }): INotificationProvider {
  return {
    name: "fake-notification",
    async send(_payload: NotificationPayload): Promise<ProviderResult<{ delivered: boolean; messageId?: string }>> {
      if (opts.ok) {
        return { ok: true, data: { delivered: true, messageId: "FAKE-MSG-" + Date.now() } };
      }
      return {
        ok: false,
        error: { code: "FAKE_FAILURE", message: opts.errorMessage ?? "fake failure" },
      };
    },
  };
}

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  testEmail = `notif-test-${suffix}@turbopay.test`;
  testPhone = `+234700888${suffix.padStart(4, "0").slice(-4)}`;
  const user = await db.user.create({
    data: {
      fullName: "Notification Test",
      email: testEmail,
      phone: testPhone,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
});

afterAll(async () => {
  await db.notificationLog.deleteMany({ where: { userId: testUserId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

beforeEach(async () => {
  // Clear any notification logs from prior tests.
  await db.notificationLog.deleteMany({ where: { userId: testUserId } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Notification retry queue", () => {
  it("send() marks the NotificationLog as FAILED when the provider returns failure", async () => {
    // Stub the provider resolver to return a failing fake.
    vi.spyOn(providers, "notification").mockResolvedValue(makeFakeProvider({ ok: false, errorMessage: "boom" }));

    const result = await notify.send({
      to: testPhone,
      channel: "SMS",
      template: "transaction.debit",
      variables: { amount: "1000" },
      userId: testUserId,
    });

    expect(result.delivered).toBe(false);
    expect(result.error).toBe("boom");

    const log = await db.notificationLog.findFirst({
      where: { userId: testUserId, template: "transaction.debit" },
    });
    expect(log).not.toBeNull();
    expect(log!.status).toBe("FAILED");
    expect(log!.retryCount).toBe(0);
    expect(log!.errorMsg).toBe("boom");
  });

  it("retryFailed() re-attempts delivery and marks SENT on success (retryCount incremented)", async () => {
    // First, fail an initial send.
    vi.spyOn(providers, "notification").mockResolvedValue(makeFakeProvider({ ok: false, errorMessage: "boom" }));
    await notify.send({
      to: testPhone,
      channel: "SMS",
      template: "transaction.debit",
      variables: { amount: "1000" },
      userId: testUserId,
    });

    let log = await db.notificationLog.findFirst({ where: { userId: testUserId } });
    expect(log!.status).toBe("FAILED");
    expect(log!.retryCount).toBe(0);

    // Now flip the provider to succeed and run the retry queue.
    vi.spyOn(providers, "notification").mockResolvedValue(makeFakeProvider({ ok: true }));
    const result = await notify.retryFailed(24);
    expect(result.retried).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    log = await db.notificationLog.findFirst({ where: { userId: testUserId } });
    expect(log!.status).toBe("SENT");
    expect(log!.retryCount).toBe(1);
    expect(log!.messageId).toBeTruthy();
    expect(log!.errorMsg).toBeNull();
  });

  it("after MAX_NOTIFICATION_RETRIES failed retries the entry is marked PERMANENTLY_FAILED", async () => {
    // Initial send fails.
    vi.spyOn(providers, "notification").mockResolvedValue(makeFakeProvider({ ok: false, errorMessage: "persistent failure" }));
    await notify.send({
      to: testPhone,
      channel: "SMS",
      template: "transaction.credit",
      variables: { amount: "2000" },
      userId: testUserId,
    });

    // Run retryFailed MAX_NOTIFICATION_RETRIES times — each should fail.
    for (let i = 0; i < MAX_NOTIFICATION_RETRIES; i++) {
      const result = await notify.retryFailed(24);
      expect(result.retried).toBeGreaterThanOrEqual(1);
      expect(result.succeeded).toBe(0);
    }

    // After MAX_NOTIFICATION_RETRIES failed retries, status should be PERMANENTLY_FAILED
    // and retryCount should equal MAX_NOTIFICATION_RETRIES.
    const log = await db.notificationLog.findFirst({ where: { userId: testUserId } });
    expect(log!.status).toBe("PERMANENTLY_FAILED");
    expect(log!.retryCount).toBe(MAX_NOTIFICATION_RETRIES);

    // The next retryFailed() run must NOT pick this entry up — it's exhausted.
    const idleRun = await notify.retryFailed(24);
    expect(idleRun.retried).toBe(0);
  });
});
