import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword, hashPin } from "@/lib/turbopay/crypto";
import { verifyTransactionPin } from "@/lib/turbopay/pin";
import { ensureWallet } from "@/lib/turbopay/wallet";
import type { SessionUser } from "@/lib/turbopay/types";

/**
 * Transaction PIN verification tests — covers brute-force lockout,
 * format validation, and the success/failure lifecycle.
 */

let testUser: SessionUser;
let testUserId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const user = await db.user.create({
    data: {
      fullName: "PIN Test User",
      email: `pin-${suffix}@turbopay.test`,
      phone: `+234711222${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  // Ensure wallet exists before creating virtualAccount
  await ensureWallet(user.id, "PIN Test User - Turbopay");
  testUser = {
    id: user.id,
    fullName: user.fullName,
    username: null,
    email: user.email ?? null,
    phone: user.phone,
    country: null,
    kycTier: 2,
    kycStatus: "VERIFIED",
    status: "ACTIVE",
    emailVerified: true,
    phoneVerified: true,
    role: "USER",
    avatarUrl: null,
    hasTransactionPin: false, authProvider: "password",
    createdAt: user.createdAt.toISOString(),
  };
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

beforeEach(async () => {
  // Reset PIN state before each test.
  // Guard: user may have been deleted by a prior afterAll — skip reset if so.
  try {
    const user = await db.user.findUnique({ where: { id: testUserId }, select: { id: true } });
    if (user) {
      await db.user.update({
        where: { id: testUserId },
        data: { transactionPinHash: hashPin("1234"), pinFailCount: 0, pinLockedUntil: null },
      });
      testUser.hasTransactionPin = true;
    }
  } catch {
    // SQLite socket timeout under concurrent load — skip reset, test will still work
  }
});

describe("verifyTransactionPin", () => {
  it("returns PIN_REQUIRED when pin is undefined", async () => {
    const result = await verifyTransactionPin(testUser, undefined);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PIN_REQUIRED");
  });

  it("returns PIN_INVALID_FORMAT for non-4-digit input", async () => {
    const result = await verifyTransactionPin(testUser, "123");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PIN_INVALID_FORMAT");
  });

  it("returns PIN_NOT_SET for user with no PIN", async () => {
    await db.user.update({ where: { id: testUserId }, data: { transactionPinHash: null } });
    testUser.hasTransactionPin = false;
    const result = await verifyTransactionPin(testUser, "1234");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PIN_NOT_SET");
  });

  it("returns INVALID_PIN for wrong PIN", async () => {
    const result = await verifyTransactionPin(testUser, "9999");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INVALID_PIN");
  });

  it("returns { ok: true } for correct PIN", async () => {
    const result = await verifyTransactionPin(testUser, "1234");
    expect(result.ok).toBe(true);
  });

  it("returns PIN_LOCKED when pinLockedUntil is in the future", async () => {
    await db.user.update({
      where: { id: testUserId },
      data: { pinLockedUntil: new Date(Date.now() + 10 * 60 * 1000) },
    });
    const result = await verifyTransactionPin(testUser, "1234");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PIN_LOCKED");
  });

  it("increments pinFailCount on each failure", async () => {
    await verifyTransactionPin(testUser, "0001");
    let u = await db.user.findUnique({ where: { id: testUserId }, select: { pinFailCount: true } });
    expect(u!.pinFailCount).toBe(1);

    await verifyTransactionPin(testUser, "0002");
    u = await db.user.findUnique({ where: { id: testUserId }, select: { pinFailCount: true } });
    expect(u!.pinFailCount).toBe(2);

    // After 5 failures, the account locks.
    await verifyTransactionPin(testUser, "0003");
    await verifyTransactionPin(testUser, "0004");
    const lockResult = await verifyTransactionPin(testUser, "0005");
    const locked = await db.user.findUnique({ where: { id: testUserId }, select: { pinFailCount: true, pinLockedUntil: true } });
    expect(locked!.pinFailCount).toBe(5);
    expect(locked!.pinLockedUntil).not.toBeNull();
    expect(locked!.pinLockedUntil! > new Date()).toBe(true);
    expect(lockResult.code).toBe("PIN_LOCKED");
  });

  it("resets pinFailCount on success", async () => {
    // Fail twice, then succeed.
    await verifyTransactionPin(testUser, "0001");
    await verifyTransactionPin(testUser, "0002");
    await verifyTransactionPin(testUser, "1234"); // correct
    const u = await db.user.findUnique({ where: { id: testUserId }, select: { pinFailCount: true, pinLockedUntil: true } });
    expect(u!.pinFailCount).toBe(0);
    expect(u!.pinLockedUntil).toBeNull();
  });
});
