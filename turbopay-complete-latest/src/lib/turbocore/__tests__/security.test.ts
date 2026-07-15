import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import {
  registerDevice,
  trustDevice,
  revokeDevice,
  listDevices,
  computeRiskScore,
  requireStepUp,
  verifyStepUp,
  deviceFingerprint,
  parseDeviceName,
  recordSecurityEvent,
  getSecurityTimeline,
} from "@/lib/turbocore/security";

/**
 * Security Center tests — device recognition, trusted devices, risk scoring,
 * step-up OTP, and the unified security timeline.
 */

let testUserId: string;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0";
const IP = "197.210.45.12";

beforeAll(async () => {
  const user = await db.user.create({
    data: {
      fullName: "Security Test",
      email: "security-test@turbopay.test",
      phone: "+2347990000001",
      passwordHash: hashPassword("testpassword123"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  await ensureWallet(user.id, "Security Test - Turbopay");
});

afterAll(async () => {
  await db.securityEvent.deleteMany({ where: { userId: testUserId } });
  await db.device.deleteMany({ where: { userId: testUserId } });
  await db.recoveryToken.deleteMany({ where: { userId: testUserId } });
  await db.ledgerEntry.deleteMany({ where: { wallet: { userId: testUserId } } });
  await db.transaction.deleteMany({ where: { userId: testUserId } });
  await db.wallet.deleteMany({ where: { userId: testUserId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

describe("Device management", () => {
  it("registerDevice creates a new device on first sight", async () => {
    const { device, isNew } = await registerDevice(testUserId, UA, IP);
    expect(isNew).toBe(true);
    expect(device.deviceName).toBe("Chrome on macOS");
    expect(device.trusted).toBe(false);
  });

  it("registerDevice recognises an existing device on second sight", async () => {
    const { isNew } = await registerDevice(testUserId, UA, IP);
    expect(isNew).toBe(false);
  });

  it("listDevices returns the registered device", async () => {
    const devices = await listDevices(testUserId);
    expect(devices.length).toBeGreaterThanOrEqual(1);
    expect(devices[0].deviceName).toBe("Chrome on macOS");
  });

  it("trustDevice marks a device as trusted", async () => {
    const devices = await listDevices(testUserId);
    const id = devices[0].id;
    await trustDevice(testUserId, id);
    const updated = await listDevices(testUserId);
    expect(updated.find((d) => d.id === id)?.trusted).toBe(true);
  });

  it("revokeDevice removes the device", async () => {
    const devices = await listDevices(testUserId);
    const id = devices[0].id;
    await revokeDevice(testUserId, id);
    const after = await listDevices(testUserId);
    expect(after.find((d) => d.id === id)).toBeUndefined();
  });
});

describe("Risk scoring", () => {
  it("returns a low score for a known device with no amount", async () => {
    // Register a device first so it's known.
    await registerDevice(testUserId, UA, IP);
    const risk = await computeRiskScore(testUserId, { isNewDevice: false, ip: IP });
    expect(risk.score).toBeLessThan(30);
    expect(risk.level).toBe("low");
  });

  it("adds 30 for a new device", async () => {
    const risk = await computeRiskScore(testUserId, { isNewDevice: true, ip: "10.0.0.99" });
    expect(risk.score).toBeGreaterThanOrEqual(30);
    expect(risk.factors).toContain("New device");
  });
});

describe("Step-up authentication", () => {
  it("requireStepUp returns a 6-digit OTP", async () => {
    const { otp } = await requireStepUp(testUserId, "large_transfer");
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("verifyStepUp succeeds with the correct OTP", async () => {
    const { otp } = await requireStepUp(testUserId, "test");
    const ok = await verifyStepUp(testUserId, otp);
    expect(ok).toBe(true);
  });

  it("verifyStepUp fails with a wrong OTP", async () => {
    const ok = await verifyStepUp(testUserId, "000000");
    expect(ok).toBe(false);
  });

  it("verifyStepUp fails with an expired OTP", async () => {
    // Create an already-expired token directly.
    await db.recoveryToken.create({
      data: {
        userId: testUserId,
        channel: "PHONE",
        target: "step-up",
        code: "999999",
        purpose: "STEP_UP",
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const ok = await verifyStepUp(testUserId, "999999");
    expect(ok).toBe(false);
  });
});

describe("Security timeline", () => {
  it("returns events in descending time order", async () => {
    await recordSecurityEvent(testUserId, "PIN_CHANGED");
    await recordSecurityEvent(testUserId, "PASSWORD_CHANGED");
    const timeline = await getSecurityTimeline(testUserId, { limit: 10 });
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    // Descending: the most recent event should be first.
    expect(new Date(timeline[0].ts).getTime()).toBeGreaterThanOrEqual(
      new Date(timeline[1].ts).getTime(),
    );
  });
});

describe("Utilities", () => {
  it("parseDeviceName extracts browser + OS", () => {
    expect(parseDeviceName(UA)).toBe("Chrome on macOS");
    expect(parseDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604")).toBe("Safari on iOS");
  });

  it("deviceFingerprint is stable for same UA + subnet", () => {
    const a = deviceFingerprint(UA, "197.210.45.12");
    const b = deviceFingerprint(UA, "197.210.45.99"); // same /24
    expect(a).toBe(b);
  });

  it("deviceFingerprint differs for different UA", () => {
    const a = deviceFingerprint(UA, IP);
    const b = deviceFingerprint("Mozilla/5.0 (Windows NT 10.0) Chrome/120", IP);
    expect(a).not.toBe(b);
  });
});
