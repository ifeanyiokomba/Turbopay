import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  hashPassword,
  hashPin,
  verifyPassword,
  hashToken,
  randomToken,
} from "@/lib/turbopay/crypto";
import { verifyTransactionPin } from "@/lib/turbopay/pin";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { POST as loginPost } from "@/app/api/auth/login/route";
import type { SessionUser } from "@/lib/turbopay/types";

/**
 * AUTH HARDENING TESTS — covers the gaps flagged in the auth audit:
 *   1. Login brute-force lockout (per-user, after 5 failures)
 *   2. PIN brute-force lockout (per-user, after 5 failures)
 *   3. Session expiry (expiresAt in the past → invalid)
 *   4. Session revocation (revokedAt set → invalid)
 *   5. Token replay after logout (revoked token must not authenticate)
 *   6. Rate limiting (in-memory sliding window blocks the 11th call)
 *   7. Password verification (scrypt hash/verify round-trip)
 *   8. Timing-safe comparison (no throw on same-length wrong input / malformed hash)
 *
 * Pattern mirrors pin.test.ts: real SQLite dev DB, hermetic users created in
 * beforeAll, full teardown in afterAll, state reset in beforeEach.
 *
 * NOTE: createSession / getSessionUser / logout use next/headers cookies(),
 * which require a Next.js request context and throw outside one. Where those
 * functions can't be called directly, we test the underlying DB + validity
 * logic (the exact same checks getSessionUser performs on the Session row).
 */

// ─── Test fixtures ─────────────────────────────────────────────
let loginUserId: string;
let pinUserId: string;
let sessionUserId: string;
let pinTestUser: SessionUser;

const LOGIN_PASSWORD = "CorrectHorseBatteryStaple!9";
const LOGIN_EMAIL = "auth-login-test@turbopay.test";
const PIN_EMAIL = "auth-pin-test@turbopay.test";
const SESSION_EMAIL = "auth-session-test@turbopay.test";

// Unique rate-limit key per test run — isolates this suite from the
// module-level in-memory store shared with the login route's own rate-limit
// calls (which use keys "login" and "login-user").
const RATE_LIMIT_KEY = `auth-test-rl-${Date.now()}-${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
  // User for the login brute-force test.
  const loginUser = await db.user.create({
    data: {
      fullName: "Auth Login Test",
      email: LOGIN_EMAIL,
      phone: "+2347111110001",
      passwordHash: hashPassword(LOGIN_PASSWORD),
      kycTier: 2,
      kycStatus: "VERIFIED",
      status: "ACTIVE",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  loginUserId = loginUser.id;

  // User for the PIN brute-force test.
  const pinUser = await db.user.create({
    data: {
      fullName: "Auth PIN Test",
      email: PIN_EMAIL,
      phone: "+2347111110002",
      passwordHash: hashPassword("irrelevant-password-1"),
      transactionPinHash: hashPin("4321"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      status: "ACTIVE",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  pinUserId = pinUser.id;
  pinTestUser = {
    id: pinUser.id,
    fullName: pinUser.fullName,
    username: null,
    email: pinUser.email ?? null,
    phone: pinUser.phone,
    country: null,
    kycTier: 2,
    kycStatus: "VERIFIED",
    status: "ACTIVE",
    emailVerified: true,
    phoneVerified: true,
    role: "USER",
    avatarUrl: null,
    hasTransactionPin: true,
    authProvider: "password",
    createdAt: pinUser.createdAt.toISOString(),
  };

  // User for the session expiry / revocation / replay tests.
  const sessionUser = await db.user.create({
    data: {
      fullName: "Auth Session Test",
      email: SESSION_EMAIL,
      phone: "+2347111110003",
      passwordHash: hashPassword("irrelevant-password-2"),
      kycTier: 1,
      kycStatus: "VERIFIED",
      status: "ACTIVE",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  sessionUserId = sessionUser.id;
});

afterAll(async () => {
  // Clean up all test data (sessions cascade on user delete, but we delete
  // them explicitly first to be safe; login history + audit logs are
  // deleted by identifier/userId to avoid orphaned rows).
  await db.session.deleteMany({
    where: { userId: { in: [loginUserId, pinUserId, sessionUserId] } },
  });
  await db.loginHistory.deleteMany({ where: { identifier: LOGIN_EMAIL } });
  await db.auditLog.deleteMany({
    where: { userId: { in: [loginUserId, pinUserId, sessionUserId] } },
  });
  await db.user.deleteMany({
    where: { id: { in: [loginUserId, pinUserId, sessionUserId] } },
  });
  await db.$disconnect();
});

beforeEach(async () => {
  // Reset lockout counters before each test so they start from a clean state.
  // Guard: users may have been deleted by a prior afterAll — skip reset if so.
  const loginUser = await db.user.findUnique({ where: { id: loginUserId }, select: { id: true } });
  if (loginUser) {
    await db.user.update({
      where: { id: loginUserId },
      data: { loginFailCount: 0, loginLockedUntil: null },
    });
  }
  const pinUser = await db.user.findUnique({ where: { id: pinUserId }, select: { id: true } });
  if (pinUser) {
    await db.user.update({
      where: { id: pinUserId },
      data: { transactionPinHash: hashPin("4321"), pinFailCount: 0, pinLockedUntil: null },
    });
    pinTestUser.hasTransactionPin = true;
  }
});

// ─── Helpers ───────────────────────────────────────────────────

/** Build a login POST Request the same shape the real client sends. */
function loginReq(identifier: string, password: string): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": "vitest-auth-test/1.0",
    },
    body: JSON.stringify({ identifier, password }),
  });
}

/**
 * Mirror of the session-validity logic inside getSessionUser (auth.ts),
 * WITHOUT the next/headers cookie/header reading (which needs a request
 * context). Returns true iff the token maps to a non-revoked, non-expired
 * session — i.e. getSessionUser would return a user.
 */
async function isSessionTokenValid(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const session = await db.session.findUnique({ where: { tokenHash } });
  if (!session) return false;
  if (session.revokedAt) return false;
  if (session.expiresAt < new Date()) return false;
  return true;
}

// ─── 1. Login brute-force lockout ──────────────────────────────

describe("login brute-force lockout", () => {
  it("locks after 5 failed attempts and rejects the correct password while locked, then unlocks on clear", async () => {
    // 5 wrong-password attempts. The 5th triggers the lock (sets
    // loginLockedUntil); all 5 return 401 INVALID_CREDENTIALS because the
    // lock is applied AFTER the password check fails and enforced on the
    // NEXT attempt (the lockout check runs before password verification).
    for (let i = 1; i <= 5; i++) {
      const res = await loginPost(loginReq(LOGIN_EMAIL, "definitely-wrong"));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe("INVALID_CREDENTIALS");
    }

    // After 5 failures the account is locked: counter at 5, lock in the future.
    const after5 = await db.user.findUnique({
      where: { id: loginUserId },
      select: { loginFailCount: true, loginLockedUntil: true },
    });
    expect(after5!.loginFailCount).toBe(5);
    expect(after5!.loginLockedUntil).not.toBeNull();
    expect(after5!.loginLockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // 6th attempt with the CORRECT password → 423 ACCOUNT_LOCKED.
    // The lockout check runs BEFORE password verification, so even the right
    // password is rejected while the account is locked.
    const sixth = await loginPost(loginReq(LOGIN_EMAIL, LOGIN_PASSWORD));
    expect(sixth.status).toBe(423);
    const sixthBody = await sixth.json();
    expect(sixthBody.code).toBe("ACCOUNT_LOCKED");

    // Manually clear the lockout (simulating an admin/support unlock).
    await db.user.update({
      where: { id: loginUserId },
      data: { loginLockedUntil: null, loginFailCount: 0 },
    });

    // The correct password now works: lockout cleared + credentials valid.
    const cleared = await db.user.findUnique({
      where: { id: loginUserId },
      select: { passwordHash: true, loginLockedUntil: true, loginFailCount: true },
    });
    expect(cleared!.loginLockedUntil).toBeNull();
    expect(cleared!.loginFailCount).toBe(0);
    // verifyPassword is the exact credential check the login route performs
    // after the lockout check passes — true here means the route would accept
    // the password (createSession throws only because of the missing cookie
    // context in tests, not because of credential failure).
    expect(verifyPassword(LOGIN_PASSWORD, cleared!.passwordHash!)).toBe(true);
  });
});

// ─── 2. PIN brute-force lockout ────────────────────────────────

describe("PIN brute-force lockout", () => {
  it("locks the PIN after 5 failed attempts and rejects the correct PIN while locked", async () => {
    // 5 wrong-PIN attempts. The 5th triggers the lock and returns PIN_LOCKED
    // (verifyTransactionPin returns PIN_LOCKED immediately once the threshold
    // is reached, unlike login which returns INVALID_CREDENTIALS on the
    // threshold attempt).
    for (let i = 1; i <= 4; i++) {
      const r = await verifyTransactionPin(pinTestUser, "0001");
      expect(r.ok).toBe(false);
      expect(r.code).toBe("INVALID_PIN");
    }
    const fifth = await verifyTransactionPin(pinTestUser, "0001");
    expect(fifth.ok).toBe(false);
    expect(fifth.code).toBe("PIN_LOCKED");

    // DB: pinLockedUntil is set in the future, counter at 5.
    const locked = await db.user.findUnique({
      where: { id: pinUserId },
      select: { pinFailCount: true, pinLockedUntil: true },
    });
    expect(locked!.pinFailCount).toBe(5);
    expect(locked!.pinLockedUntil).not.toBeNull();
    expect(locked!.pinLockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Correct PIN also fails while locked (lockout check before verify).
    const correctWhileLocked = await verifyTransactionPin(pinTestUser, "4321");
    expect(correctWhileLocked.ok).toBe(false);
    expect(correctWhileLocked.code).toBe("PIN_LOCKED");
  });
});

// ─── 3. Session expiry ─────────────────────────────────────────

describe("session expiry", () => {
  it("treats a session with expiresAt in the past as expired (invalid)", async () => {
    const token = randomToken(32);
    await db.session.create({
      data: {
        userId: sessionUserId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() - 1000), // 1 second in the past
      },
    });

    // getSessionUser would return null for an expired session.
    expect(await isSessionTokenValid(token)).toBe(false);
  });
});

// ─── 4. Session revocation ─────────────────────────────────────

describe("session revocation", () => {
  it("treats a revoked session as invalid (logout flow)", async () => {
    const token = randomToken(32);
    await db.session.create({
      data: {
        userId: sessionUserId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    // Before revocation: valid.
    expect(await isSessionTokenValid(token)).toBe(true);

    // Revoke it (this is what logout() does — sets revokedAt on the row).
    await db.session.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { revokedAt: new Date() },
    });

    // After revocation: invalid.
    expect(await isSessionTokenValid(token)).toBe(false);
  });
});

// ─── 5. Token replay after logout ──────────────────────────────

describe("token replay after logout", () => {
  it("rejects a token whose session was revoked (attacker replays old token)", async () => {
    const token = randomToken(32);
    const tokenHash = hashToken(token);
    await db.session.create({
      data: {
        userId: sessionUserId,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Logout: revoke the session (logout() sets revokedAt, does NOT delete
    // the row — so the token hash still resolves, but the session is dead).
    await db.session.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });

    // Attacker replays the old token: hash it + look it up. The row still
    // exists (we don't delete on logout) but is revoked.
    const replayedHash = hashToken(token);
    const row = await db.session.findUnique({ where: { tokenHash: replayedHash } });
    expect(row).not.toBeNull();
    expect(row!.revokedAt).not.toBeNull();

    // The getSessionUser-equivalent validity check returns false — the
    // replayed token must NOT authenticate.
    expect(await isSessionTokenValid(token)).toBe(false);
  });
});

// ─── 6. Rate limiting (in-memory sliding window) ───────────────

describe("rate limiting", () => {
  it("blocks the 11th request in a 10-request window", async () => {
    // Use the public rateLimit() function — when REDIS_URL is not set (the
    // dev/test default) it falls back to the in-memory memRateLimit backend.
    // The unique key isolates this test from the login route's own rate-limit
    // buckets ("login" / "login-user").
    const req = new Request("http://localhost/api/test", { method: "GET" });
    const opts = { key: RATE_LIMIT_KEY, limit: 10, windowMs: 60_000 };

    // First 10 requests: allowed (rateLimit returns null).
    for (let i = 1; i <= 10; i++) {
      const result = await rateLimit(req, opts);
      expect(result).toBeNull();
    }

    // 11th request: blocked → 429 RATE_LIMITED response.
    const blocked = await rateLimit(req, opts);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    const body = (await blocked!.json()) as { code?: string; error?: string };
    expect(body.code).toBe("RATE_LIMITED");
    // RFC 6585: a 429 MUST include Retry-After.
    expect(blocked!.headers.get("Retry-After")).not.toBeNull();
  });
});

// ─── 7. Password verification ──────────────────────────────────

describe("password verification", () => {
  it("hashes and verifies passwords correctly (scrypt round-trip)", () => {
    const password = "MySecretPassword123!";
    const hash = hashPassword(password);

    // Correct password → true.
    expect(verifyPassword(password, hash)).toBe(true);
    // Wrong password → false.
    expect(verifyPassword("WrongPassword123!", hash)).toBe(false);
    // Correct password against a DIFFERENT hash → false.
    expect(verifyPassword(password, hashPassword("DifferentPassword!"))).toBe(false);
  });

  it("produces a unique salt per hash (same password → different hashes)", () => {
    const a = hashPassword("samePassword");
    const b = hashPassword("samePassword");
    expect(a).not.toBe(b); // different salts
    expect(verifyPassword("samePassword", a)).toBe(true);
    expect(verifyPassword("samePassword", b)).toBe(true);
  });
});

// ─── 8. Timing-safe comparison ─────────────────────────────────

describe("timing-safe comparison", () => {
  it("does not throw on a wrong password of the same length as the correct one", () => {
    const hash = hashPassword("12345678");
    // scrypt output length is fixed by keylen (64 bytes), so both buffers
    // passed to timingSafeEqual are always equal length — this must not throw.
    expect(() => verifyPassword("87654321", hash)).not.toThrow();
    expect(verifyPassword("87654321", hash)).toBe(false);
  });

  it("does not throw on a wrong password of a different length", () => {
    const hash = hashPassword("longpassword");
    expect(() => verifyPassword("short", hash)).not.toThrow();
    expect(verifyPassword("short", hash)).toBe(false);
  });

  it("returns false for a malformed stored hash that fails the parts-length guard", () => {
    // verifyPassword guards with `parts.length !== 3` before reaching
    // timingSafeEqual — a non-scrypt string (no `$` separators) returns false
    // cleanly without invoking the buffer comparison.
    expect(() => verifyPassword("anything", "not-a-valid-hash")).not.toThrow();
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
    expect(() => verifyPassword("anything", "")).not.toThrow();
    expect(verifyPassword("anything", "")).toBe(false);
    expect(() => verifyPassword("anything", "scrypt$only")).not.toThrow();
    expect(verifyPassword("anything", "scrypt$only")).toBe(false);
  });
});
