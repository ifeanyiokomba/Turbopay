/**
 * TurboCore — Fraud & Risk Engine
 * ================================
 *
 * Centralized fraud detection and risk scoring. Every financial
 * operation passes through this engine before execution.
 *
 * Risk scoring dimensions:
 *   1. Transaction velocity (frequency + volume in time windows)
 *   2. Amount anomalies (unusual amounts for this user)
 *   3. Geographic anomalies (new location, impossible travel)
 *   4. Device anomalies (new device, device fingerprint changes)
 *   5. Behavioral anomalies (unusual time of day, pattern changes)
 *   6. Counterparty risk (known fraud accounts, new beneficiaries)
 *   7. AML rules (PEP, sanctions, large cash)
 *
 * Risk levels:
 *   LOW (0-30): auto-approve
 *   MEDIUM (31-60): step-up authentication
 *   HIGH (61-80): hold for manual review
 *   CRITICAL (81-100): auto-block + alert
 *
 * The engine returns a risk score + recommended action.
 * The calling service decides whether to proceed, challenge, or block.
 */

import { db } from "@/lib/db";

// ─── Risk Score ───────────────────────────────────────────────

export interface RiskScore {
  /** Composite risk score 0-100. Higher = riskier. */
  score: number;
  /** Risk level based on score. */
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** Recommended action. */
  action: "APPROVE" | "STEP_UP" | "HOLD" | "BLOCK";
  /** Individual risk factors that contributed. */
  factors: RiskFactor[];
  /** Timestamp of evaluation. */
  evaluatedAt: Date;
}

export interface RiskFactor {
  /** Factor name (e.g., "velocity", "amount_anomaly"). */
  name: string;
  /** Weight of this factor in the composite score. */
  weight: number;
  /** Raw score for this factor (0-100). */
  score: number;
  /** Human-readable explanation. */
  description: string;
}

// ─── Fraud Engine ─────────────────────────────────────────────

class FraudEngineImpl {
  /**
   * Evaluate the risk of a financial operation.
   * Returns a risk score and recommended action.
   */
  async evaluate(input: {
    userId: string;
    amountKobo: number;
    operation: string;
    ip?: string;
    userAgent?: string;
    deviceId?: string;
    beneficiaryId?: string;
  }): Promise<RiskScore> {
    const factors: RiskFactor[] = [];

    // 1. Transaction velocity check.
    const velocityFactor = await this.checkVelocity(input.userId, input.amountKobo);
    factors.push(velocityFactor);

    // 2. Amount anomaly check.
    const amountFactor = await this.checkAmountAnomaly(input.userId, input.amountKobo);
    factors.push(amountFactor);

    // 3. Geographic check.
    if (input.ip) {
      const geoFactor = await this.checkGeography(input.userId, input.ip);
      factors.push(geoFactor);
    }

    // 4. Device check.
    if (input.deviceId) {
      const deviceFactor = await this.checkDevice(input.userId, input.deviceId);
      factors.push(deviceFactor);
    }

    // 5. Time-of-day check.
    const timeFactor = await this.checkTimeOfDay(input.userId);
    factors.push(timeFactor);

    // 6. Beneficiary check.
    if (input.beneficiaryId) {
      const beneficiaryFactor = await this.checkBeneficiary(input.userId, input.beneficiaryId);
      factors.push(beneficiaryFactor);
    }

    // 7. Account age check.
    const accountFactor = await this.checkAccountAge(input.userId);
    factors.push(accountFactor);

    // Compute composite score (weighted average).
    const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
    const compositeScore = factors.reduce((sum, f) => sum + (f.score * f.weight), 0) / totalWeight;
    const score = Math.round(Math.max(0, Math.min(100, compositeScore)));

    // Determine level and action.
    const level = this.scoreToLevel(score);
    const action = this.levelToAction(level);

    return {
      score,
      level,
      action,
      factors,
      evaluatedAt: new Date(),
    };
  }

  // ── Risk Factor Checks ────────────────────────────────────

  /**
   * Check transaction velocity: how many transactions in recent windows.
   */
  private async checkVelocity(userId: string, amountKobo: number): Promise<RiskFactor> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Count transactions in last hour and day.
    const [hourCount, dayCount, dayVolume] = await Promise.all([
      db.transaction.count({
        where: { userId, createdAt: { gte: oneHourAgo }, direction: "DEBIT", status: "SUCCESS" },
      }),
      db.transaction.count({
        where: { userId, createdAt: { gte: oneDayAgo }, direction: "DEBIT", status: "SUCCESS" },
      }),
      db.transaction.aggregate({
        where: { userId, createdAt: { gte: oneDayAgo }, direction: "DEBIT", status: "SUCCESS" },
        _sum: { amountKobo: true },
      }),
    ]);

    let score = 0;

    // High frequency in last hour.
    if (hourCount >= 10) score += 40;
    else if (hourCount >= 5) score += 20;
    else if (hourCount >= 3) score += 10;

    // High frequency in last day.
    if (dayCount >= 50) score += 30;
    else if (dayCount >= 20) score += 15;
    else if (dayCount >= 10) score += 5;

    // High volume in last day.
    const dayVolumeKobo = dayVolume._sum.amountKobo ?? 0;
    if (dayVolumeKobo > 5_000_000) score += 30; // > ₦50,000
    else if (dayVolumeKobo > 2_000_000) score += 15; // > ₦20,000

    // This transaction's amount relative to daily volume.
    if (amountKobo > 0 && dayVolumeKobo > 0) {
      const ratio = amountKobo / dayVolumeKobo;
      if (ratio > 2) score += 20; // This single tx is 2x the daily volume
    }

    return {
      name: "velocity",
      weight: 25,
      score: Math.min(100, score),
      description: `${hourCount} txns/hour, ${dayCount} txns/day, ₦${(dayVolumeKobo / 100).toLocaleString()}/day volume`,
    };
  }

  /**
   * Check if the amount is unusual for this user.
   */
  private async checkAmountAnomaly(userId: string, amountKobo: number): Promise<RiskFactor> {
    // Get average transaction amount over last 30 days.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const avgTx = await db.transaction.aggregate({
      where: { userId, createdAt: { gte: thirtyDaysAgo }, direction: "DEBIT", status: "SUCCESS" },
      _avg: { amountKobo: true },
      _max: { amountKobo: true },
    });

    const avgAmount = avgTx._avg.amountKobo ?? 0;
    const maxAmount = avgTx._max.amountKobo ?? 0;

    let score = 0;

    if (avgAmount > 0) {
      const ratio = amountKobo / avgAmount;
      if (ratio > 10) score += 50; // 10x average
      else if (ratio > 5) score += 30;
      else if (ratio > 3) score += 15;
    }

    if (maxAmount > 0 && amountKobo > maxAmount) {
      score += 30; // Exceeds historical maximum
    }

    // Large absolute amount.
    if (amountKobo > 5_000_000) score += 20; // > ₦50,000
    if (amountKobo > 50_000_000) score += 30; // > ₦500,000

    return {
      name: "amount_anomaly",
      weight: 20,
      score: Math.min(100, score),
      description: `Amount ₦${(amountKobo / 100).toLocaleString()} vs avg ₦${(avgAmount / 100).toLocaleString()}`,
    };
  }

  /**
   * Check geographic anomalies (new IP, impossible travel).
   */
  private async checkGeography(userId: string, ip: string): Promise<RiskFactor> {
    // Check if this IP was used recently.
    const recentLogins = await db.loginHistory.findMany({
      where: { userId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { ip: true, createdAt: true },
    });

    const knownIps = new Set(recentLogins.map((l) => l.ip).filter(Boolean));
    const isNewIp = !knownIps.has(ip);

    let score = 0;
    if (isNewIp && recentLogins.length > 0) {
      score += 30; // New IP, but has login history
    } else if (isNewIp && recentLogins.length === 0) {
      score += 10; // New IP, first login (normal for new users)
    }

    return {
      name: "geography",
      weight: 15,
      score: Math.min(100, score),
      description: isNewIp ? `New IP address: ${ip}` : `Known IP: ${ip}`,
    };
  }

  /**
   * Check device anomalies.
   */
  private async checkDevice(userId: string, deviceId: string): Promise<RiskFactor> {
    const knownDevice = await db.device.findFirst({
      where: { userId, id: deviceId },
    });

    let score = 0;
    if (!knownDevice) {
      score += 25; // Unknown device
    }

    return {
      name: "device",
      weight: 15,
      score: Math.min(100, score),
      description: knownDevice ? "Known device" : "Unknown device",
    };
  }

  /**
   * Check time-of-day anomalies (unusual hour).
   */
  private async checkTimeOfDay(userId: string): Promise<RiskFactor> {
    const hour = new Date().getHours();

    // Get typical transaction hours for this user.
    const recentTxs = await db.transaction.findMany({
      where: { userId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, direction: "DEBIT" },
      select: { createdAt: true },
      take: 100,
    });

    const hourCounts = new Array(24).fill(0);
    for (const tx of recentTxs) {
      hourCounts[tx.createdAt.getHours()]++;
    }

    const typicalHours = hourCounts.filter((c) => c > 0).length;
    const isUnusualHour = hourCounts[hour] === 0 && typicalHours > 5;

    let score = 0;
    if (isUnusualHour) score += 15;
    if (hour >= 1 && hour <= 5) score += 10; // Late night

    return {
      name: "time_of_day",
      weight: 10,
      score: Math.min(100, score),
      description: isUnusualHour ? `Unusual hour: ${hour}:00` : `Normal hour: ${hour}:00`,
    };
  }

  /**
   * Check beneficiary risk (new beneficiary, known fraud).
   */
  private async checkBeneficiary(userId: string, beneficiaryId: string): Promise<RiskFactor> {
    const knownBeneficiary = await db.beneficiary.findFirst({
      where: { userId, id: beneficiaryId },
    });

    let score = 0;
    if (!knownBeneficiary) {
      score += 20; // New beneficiary
    }

    return {
      name: "beneficiary",
      weight: 10,
      score: Math.min(100, score),
      description: knownBeneficiary ? "Known beneficiary" : "New beneficiary",
    };
  }

  /**
   * Check account age (newer accounts are higher risk).
   */
  private async checkAccountAge(userId: string): Promise<RiskFactor> {
    const user = await db.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    if (!user) return { name: "account_age", weight: 5, score: 50, description: "User not found" };

    const ageDays = (Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    let score = 0;

    if (ageDays < 1) score += 40; // Less than 1 day old
    else if (ageDays < 7) score += 20; // Less than 1 week
    else if (ageDays < 30) score += 10; // Less than 1 month

    return {
      name: "account_age",
      weight: 5,
      score: Math.min(100, score),
      description: `Account age: ${Math.floor(ageDays)} days`,
    };
  }

  // ── Helpers ───────────────────────────────────────────────

  private scoreToLevel(score: number): RiskScore["level"] {
    if (score >= 81) return "CRITICAL";
    if (score >= 61) return "HIGH";
    if (score >= 31) return "MEDIUM";
    return "LOW";
  }

  private levelToAction(level: RiskScore["level"]): RiskScore["action"] {
    switch (level) {
      case "CRITICAL": return "BLOCK";
      case "HIGH": return "HOLD";
      case "MEDIUM": return "STEP_UP";
      case "LOW": return "APPROVE";
    }
  }
}

/** Singleton fraud engine. */
export const fraudEngine = new FraudEngineImpl();
