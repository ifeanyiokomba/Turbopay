/**
 * Sanctions & Watchlist Screening Engine
 * =======================================
 *
 * Checks user names against a DB-backed sanctions list using fuzzy
 * string matching (Dice coefficient). Integrates with the existing
 * AML/compliance flow: HIGH-risk matches auto-open a compliance case
 * and freeze the user's wallet.
 *
 * The sanctions list is admin-managed via CRUD routes. Initial entries
 * can be bulk-imported from OFAC SDN, UN, or EU sanctions lists.
 *
 * Screening is performed:
 *   - At KYC verification (tier upgrade)
 *   - At high-value transaction initiation (optional, via AML pipeline)
 *   - On-demand from admin
 */

import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { complianceCases } from "./cases";

// ─── Fuzzy matching ────────────────────────────────────────────

/** Dice coefficient (Sorensen-Dice) for bigram similarity. */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    bigramsA.set(bigram, (bigramsA.get(bigram) ?? 0) + 1);
  }
  let matches = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = bigramsA.get(bigram);
    if (count && count > 0) {
      bigramsA.set(bigram, count - 1);
      matches++;
    }
  }
  return (2 * matches) / (a.length + b.length - 2);
}

/** Normalise a name for comparison: lowercase, strip punctuation, collapse whitespace. */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token-set ratio: compare as sets of words (handles name order variation). */
function tokenSetSimilarity(a: string, b: string): number {
  const tokensA = new Set(normaliseName(a).split(" "));
  const tokensB = new Set(normaliseName(b).split(" "));
  const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)));
  const union = new Set([...tokensA, ...tokensB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

// ─── Screening engine ──────────────────────────────────────────

export interface ScreeningMatch {
  entryId: string;
  name: string;
  listSource: string;
  matchScore: number; // 0-1, higher = more similar
  matchType: "exact" | "fuzzy" | "token";
}

export interface ScreeningResult {
  screened: boolean;
  matches: ScreeningMatch[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  action: "PASS" | "FLAG" | "BLOCK";
}

const EXACT_THRESHOLD = 1.0;
const FUZZY_THRESHOLD = 0.80;
const TOKEN_THRESHOLD = 0.75;

/**
 * Screen a name against the sanctions list.
 * Uses three matching strategies in order of strictness:
 *   1. Exact match (after normalisation)
 *   2. Dice coefficient fuzzy match
 *   3. Token-set similarity (handles reordered names)
 */
export async function screenName(
  fullName: string,
  options?: { nationality?: string; listSource?: string }
): Promise<ScreeningResult> {
  const normalised = normaliseName(fullName);

  // Load active entries (optionally filtered by list source)
  const where: Record<string, unknown> = { active: true };
  if (options?.listSource) where.listSource = options.listSource;

  const entries = await db.sanctionsEntry.findMany({ where, select: { id: true, name: true, listSource: true } });

  const matches: ScreeningMatch[] = [];

  for (const entry of entries) {
    const entryNormalised = normaliseName(entry.name);

    // 1. Exact match
    if (normalised === entryNormalised) {
      matches.push({ entryId: entry.id, name: entry.name, listSource: entry.listSource, matchScore: 1.0, matchType: "exact" });
      continue;
    }

    // 2. Token-set similarity (handles "Mohamed Al Baghdadi" vs "Al Baghdadi Mohamed")
    const tokenScore = tokenSetSimilarity(fullName, entry.name);
    if (tokenScore >= TOKEN_THRESHOLD) {
      matches.push({ entryId: entry.id, name: entry.name, listSource: entry.listSource, matchScore: tokenScore, matchType: "token" });
      continue;
    }

    // 3. Dice coefficient fuzzy match
    const diceScore = diceCoefficient(normalised, entryNormalised);
    if (diceScore >= FUZZY_THRESHOLD) {
      matches.push({ entryId: entry.id, name: entry.name, listSource: entry.listSource, matchScore: diceScore, matchType: "fuzzy" });
    }
  }

  // Determine risk level
  let riskLevel: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  let action: "PASS" | "FLAG" | "BLOCK" = "PASS";

  if (matches.some((m) => m.matchType === "exact")) {
    riskLevel = "HIGH";
    action = "BLOCK";
  } else if (matches.some((m) => m.matchScore >= 0.90)) {
    riskLevel = "HIGH";
    action = "FLAG";
  } else if (matches.length > 0) {
    riskLevel = "MEDIUM";
    action = "FLAG";
  }

  return { screened: true, matches, riskLevel, action };
}

/**
 * Full screening flow: screen + persist result + auto-action on HIGH risk.
 * Called from KYC verification and optionally from AML pipeline.
 */
export async function screenAndAct(
  userId: string,
  fullName: string,
  options?: { nationality?: string; listSource?: string }
): Promise<ScreeningResult> {
  const result = await screenName(fullName, options);

  // Persist the screening result
  await db.screeningResult.create({
    data: {
      userId,
      fullName,
      nationality: options?.nationality,
      matches: JSON.stringify(result.matches),
      riskLevel: result.riskLevel,
      action: result.action,
    },
  });

  // Audit log
  await audit({
    userId,
    action: "SANCTIONS_SCREENED",
    category: "AML",
    severity: result.riskLevel === "HIGH" ? "CRITICAL" : result.riskLevel === "MEDIUM" ? "WARN" : "INFO",
    metadata: {
      fullName,
      nationality: options?.nationality,
      matchCount: result.matches.length,
      riskLevel: result.riskLevel,
      action: result.action,
    },
  });

  // Auto-action on HIGH risk
  if (result.riskLevel === "HIGH") {
    // Freeze the wallet
    await db.wallet.updateMany({
      where: { userId, status: "ACTIVE" },
      data: { status: "FROZEN" },
    });
    await db.user.updateMany({
      where: { id: userId, status: "ACTIVE" },
      data: { status: "SUSPENDED" },
    });

    // Open a compliance case
    const topMatch = result.matches[0];
    await complianceCases.openCase(
      userId,
      "REVIEW",
      "HIGH",
      `Sanctions screening match: "${topMatch?.name}" on ${topMatch?.listSource} list (score: ${topMatch?.matchScore?.toFixed(2)})`,
      undefined,
      undefined
    );

    await audit({
      userId,
      action: "WALLET_FROZEN_SANCTIONS",
      category: "AML",
      severity: "CRITICAL",
      metadata: { matches: result.matches },
    });
  } else if (result.riskLevel === "MEDIUM" && result.matches.length > 0) {
    // Medium risk: open a review case but don't freeze
    const topMatch = result.matches[0];
    await complianceCases.openCase(
      userId,
      "REVIEW",
      "MEDIUM",
      `Sanctions screening potential match: "${topMatch?.name}" on ${topMatch?.listSource} list (score: ${topMatch?.matchScore?.toFixed(2)})`,
      undefined,
      undefined
    );
  }

  return result;
}

// ─── Admin CRUD ────────────────────────────────────────────────

export async function listEntries(opts?: { listSource?: string; active?: boolean; limit?: number; offset?: number }) {
  const where: Record<string, unknown> = {};
  if (opts?.listSource) where.listSource = opts.listSource;
  if (opts?.active !== undefined) where.active = opts.active;
  return db.sanctionsEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 100,
    skip: opts?.offset ?? 0,
  });
}

export async function addEntry(input: { name: string; listSource: string; country?: string; entityType?: string; reason?: string }) {
  return db.sanctionsEntry.create({ data: input });
}

export async function removeEntry(id: string) {
  return db.sanctionsEntry.delete({ where: { id } });
}

export async function toggleEntry(id: string, active: boolean) {
  return db.sanctionsEntry.update({ where: { id }, data: { active } });
}

export async function getScreeningHistory(userId: string, limit = 50) {
  return db.screeningResult.findMany({
    where: { userId },
    orderBy: { screenedAt: "desc" },
    take: limit,
  });
}
