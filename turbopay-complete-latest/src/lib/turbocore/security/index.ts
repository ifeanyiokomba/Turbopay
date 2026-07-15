import * as crypto from "node:crypto";
import { db } from "@/lib/db";
import { generateOtp, hashOtp } from "@/lib/turbopay/crypto";
import { verifyOtp } from "@/lib/turbopay/otp-verify";
import { audit } from "@/lib/turbopay/audit";

/**
 * SecurityService — the TurboCore Security Center engine.
 *
 * Provides device recognition, trusted-device management, a unified security
 * timeline, heuristic risk scoring, and step-up authentication. All state is
 * persisted via the Device / SecurityEvent / RecoveryToken (purpose="STEP_UP")
 * models — no new OTP infrastructure was introduced.
 *
 * Used by:
 *  - /api/auth/login (device registration on every login)
 *  - /api/security/* (user-facing Security Center routes)
 *  - Future: high-risk transaction step-up (transfers above a threshold)
 */

// ─── Types ────────────────────────────────────────────────────

export type SecurityEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "DEVICE_RECOGNIZED"
  | "DEVICE_NEW"
  | "DEVICE_TRUSTED"
  | "DEVICE_REVOKED"
  | "SESSION_REVOKED"
  | "PIN_CHANGED"
  | "PASSWORD_CHANGED"
  | "STEP_UP_REQUIRED"
  | "STEP_UP_PASSED"
  | "STEP_UP_FAILED";

export interface RiskContext {
  deviceFingerprint?: string;
  isNewDevice?: boolean;
  ip?: string | null;
  amountKobo?: number;
  transactionType?: string; // For behavioral pattern matching
}

export interface RiskScore {
  score: number; // 0-100
  level: "low" | "medium" | "high";
  factors: string[];
}

export interface TimelineEntry {
  id: string;
  ts: string;
  type: string;
  ip: string | null;
  deviceName: string | null;
  meta: Record<string, unknown> | null;
}

// ─── Device parsing + fingerprinting ─────────────────────────

/** Parse a User-Agent string into a human-friendly device name. */
export function parseDeviceName(ua: string): string {
  let browser = "Unknown browser";
  if (/Edg\/(\d+)/.test(ua)) browser = "Edge";
  else if (/Chrome\/(\d+)/.test(ua) && !/Edg|OPR/.test(ua)) browser = "Chrome";
  else if (/Firefox\/(\d+)/.test(ua)) browser = "Firefox";
  else if (/Safari\/(\d+)/.test(ua) && !/Chrome/.test(ua)) browser = "Safari";

  let os = "Unknown OS";
  if (/Windows NT 10/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return `${browser} on ${os}`;
}

/**
 * Stable fingerprint for a device + network: sha256(UA + /24 IP subnet).
 * The /24 subnet groups devices on the same WiFi network together so a user
 * isn't flagged for a new device merely because their DHCP lease renewed.
 */
export function deviceFingerprint(ua: string, ip: string | null | undefined): string {
  const subnet = ip ? ip.split(".").slice(0, 3).join(".") : "unknown";
  return crypto.createHash("sha256").update(`${ua}::${subnet}`).digest("hex");
}

// ─── Device management ───────────────────────────────────────

export async function registerDevice(
  userId: string,
  ua: string,
  ip: string | null,
): Promise<{ device: { id: string; fingerprint: string; deviceName: string; trusted: boolean }; isNew: boolean }> {
  const fingerprint = deviceFingerprint(ua, ip);
  const deviceName = parseDeviceName(ua);

  const existing = await db.device.findUnique({
    where: { userId_fingerprint: { userId, fingerprint } },
  });

  if (existing) {
    await db.device.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date(), ip },
    });
    await recordSecurityEvent(userId, "DEVICE_RECOGNIZED", { ip, deviceName });
    return {
      device: { id: existing.id, fingerprint, deviceName, trusted: existing.trusted },
      isNew: false,
    };
  }

  const device = await db.device.create({
    data: { userId, fingerprint, deviceName, ip, trusted: false },
  });
  await recordSecurityEvent(userId, "DEVICE_NEW", { ip, deviceName });
  return {
    device: { id: device.id, fingerprint, deviceName, trusted: false },
    isNew: true,
  };
}

export async function isDeviceTrusted(userId: string, fingerprint: string): Promise<boolean> {
  const d = await db.device.findUnique({ where: { userId_fingerprint: { userId, fingerprint } } });
  return !!d?.trusted;
}

export async function trustDevice(userId: string, deviceId: string): Promise<void> {
  const d = await db.device.findUnique({ where: { id: deviceId } });
  if (!d || d.userId !== userId) return;
  await db.device.update({ where: { id: deviceId }, data: { trusted: true } });
  await recordSecurityEvent(userId, "DEVICE_TRUSTED", { deviceName: d.deviceName });
  await audit({ userId, action: "DEVICE_TRUSTED", category: "AUTH", metadata: { deviceId } });
}

export async function revokeDevice(userId: string, deviceId: string): Promise<void> {
  const d = await db.device.findUnique({ where: { id: deviceId } });
  if (!d || d.userId !== userId) return;
  await db.device.delete({ where: { id: deviceId } });
  await recordSecurityEvent(userId, "DEVICE_REVOKED", { deviceName: d.deviceName });
  await audit({ userId, action: "DEVICE_REVOKED", category: "AUTH", metadata: { deviceId } });
}

export async function listDevices(userId: string) {
  return db.device.findMany({
    where: { userId },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, deviceName: true, ip: true, trusted: true, firstSeenAt: true, lastSeenAt: true },
  });
}

// ─── Security timeline ───────────────────────────────────────

export async function recordSecurityEvent(
  userId: string,
  type: SecurityEventType,
  meta?: { ip?: string | null; userAgent?: string | null } & Record<string, unknown>,
): Promise<void> {
  await db.securityEvent.create({
    data: {
      userId,
      type,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
      metadata: meta ? JSON.stringify(meta) : null,
    },
  }).catch(() => null); // never let logging break the flow
}

export async function getSecurityTimeline(
  userId: string,
  opts?: { limit?: number; offset?: number },
): Promise<TimelineEntry[]> {
  const limit = Math.min(opts?.limit ?? 50, 100);
  const offset = opts?.offset ?? 0;

  const [events, logins] = await Promise.all([
    db.securityEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    db.loginHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
  ]);

  const merged: TimelineEntry[] = [
    ...events.map((e) => ({
      id: e.id,
      ts: e.createdAt.toISOString(),
      type: e.type,
      ip: e.ip,
      deviceName: e.userAgent ? parseDeviceName(e.userAgent) : null,
      meta: e.metadata ? JSON.parse(e.metadata) : null,
    })),
    ...logins.map((l) => ({
      id: l.id,
      ts: l.createdAt.toISOString(),
      type: l.success ? "LOGIN_SUCCESS" : "LOGIN_FAILED",
      ip: l.ip,
      deviceName: l.userAgent ? parseDeviceName(l.userAgent) : null,
      meta: l.errorMessage ? { error: l.errorMessage } : null,
    })),
  ];

  return merged.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
}

// ─── Risk scoring ────────────────────────────────────────────

/**
 * Heuristic risk score 0-100 based on device familiarity, IP, amount, and
 * velocity. This is a starting point — a production fraud engine would add
 * ML scoring, device fingerprinting, and behavioural analytics.
 */
export async function computeRiskScore(userId: string, ctx: RiskContext): Promise<RiskScore> {
  let score = 0;
  const factors: string[] = [];

  if (ctx.isNewDevice) {
    score += 30;
    factors.push("New device");
  }

  if (ctx.ip) {
    const knownIps = await db.device.count({
      where: { userId, ip: ctx.ip },
    });
    if (knownIps === 0) {
      score += 20;
      factors.push("New IP subnet");
    }
  }

  if (ctx.amountKobo && ctx.amountKobo > 0) {
    // 95th percentile proxy: top 5% of user's transaction amounts.
    const recent = await db.transaction.findMany({
      where: { userId, status: "SUCCESS" },
      orderBy: { amountKobo: "desc" },
      take: 20,
      select: { amountKobo: true },
    });
    if (recent.length > 0) {
      const threshold = recent[Math.floor(recent.length * 0.05)]?.amountKobo ?? 0;
      if (ctx.amountKobo > threshold && threshold > 0) {
        score += 25;
        factors.push("Amount above usual range");
      }
    }
  }

  // Velocity: >5 transactions in the last 10 minutes.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const recentCount = await db.transaction.count({
    where: { userId, createdAt: { gte: tenMinAgo } },
  });
  if (recentCount > 5) {
    score += 25;
    factors.push("High transaction velocity");
  }

  // Time-of-day anomaly: transactions between 2 AM and 5 AM are unusual
  const hour = new Date().getHours();
  if (hour >= 2 && hour < 5) {
    score += 10;
    factors.push("Unusual transaction time (2-5 AM)");
  }

  // Account age risk: accounts less than 7 days old are higher risk
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  if (user) {
    const accountAgeDays = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (accountAgeDays < 7) {
      score += 15;
      factors.push("New account (< 7 days)");
    }
  }

  // Transaction type anomaly: first-time transaction type for this user
  if (ctx.transactionType) {
    const previousTypeCount = await db.transaction.count({
      where: { userId, type: ctx.transactionType, status: "SUCCESS" },
    });
    if (previousTypeCount === 0) {
      score += 10;
      factors.push(`First-time transaction type: ${ctx.transactionType}`);
    }
  }

  // Unusual transaction time pattern: most transactions happen during certain hours
  // If this transaction is outside the user's typical window, flag it
  if (ctx.ip) {
    const recentTransactions = await db.transaction.findMany({
      where: { userId, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { createdAt: true },
    });
    if (recentTransactions.length >= 5) {
      const hours = recentTransactions.map(t => t.createdAt.getHours());
      const avgHour = hours.reduce((a, b) => a + b, 0) / hours.length;
      const deviation = Math.abs(hour - avgHour);
      if (deviation > 6) {
        score += 10;
        factors.push("Transaction time deviates from user's typical pattern");
      }
    }
  }

  score = Math.min(score, 100);
  const level = score >= 60 ? "high" : score >= 30 ? "medium" : "low";
  return { score, level, factors };
}

// ─── Step-up authentication ──────────────────────────────────

const STEP_UP_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a step-up OTP for a user. Reuses the RecoveryToken table with
 * purpose "STEP_UP". In dev/sandbox the OTP is returned for delivery via
 * the notification mock; in production it would be sent via SMS/email.
 */
export async function requireStepUp(userId: string, reason: string): Promise<{ otp: string; expiresAt: Date }> {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + STEP_UP_TTL_MS);

  await db.recoveryToken.create({
    data: {
      userId,
      channel: "PHONE",
      target: "step-up",
      code: hashOtp(otp),
      purpose: "STEP_UP",
      expiresAt,
    },
  });

  await recordSecurityEvent(userId, "STEP_UP_REQUIRED", { reason });
  return { otp, expiresAt };
}

/** Verify a step-up OTP. Returns true on success, false on invalid/expired. */
export async function verifyStepUp(userId: string, otp: string): Promise<boolean> {
  const token = await db.recoveryToken.findFirst({
    where: {
      userId,
      purpose: "STEP_UP",
      consumed: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!token || !verifyOtp(hashOtp(otp), token.code)) {
    await recordSecurityEvent(userId, "STEP_UP_FAILED");
    return false;
  }

  await db.recoveryToken.update({ where: { id: token.id }, data: { consumed: true } });
  await recordSecurityEvent(userId, "STEP_UP_PASSED");
  return true;
}
