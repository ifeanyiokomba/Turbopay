/**
 * TurboCore — FX Engine
 * =====================
 * Replaces the prior 5-line getFxQuote wrapper. Provides:
 *  - Currency-pair whitelist (SUPPORTED_PAIRS + isPairSupported)
 *  - DB-driven spread/markup config (FxConfig, cached in-memory 60s)
 *  - Rate snapshots (FxRateSnapshot, TTL 5 min, refresh-on-expiry)
 *  - getQuote() — validate pair → fresh snapshot → apply spread → compute fees → audit
 *  - convert() — settlement hook: debits source wallet, credits destination wallet,
 *    posts the platform fee, audits.
 * Money is Int minor units. Uses audit(), debitWallet/creditWallet, providers.exchangeRate().
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { recordConfigVersion } from "@/lib/turbocore/config/versioning";
import { debitWallet, creditWallet } from "@/lib/turbopay/ledger";
import { providers } from "@/lib/turbocore/providers/registry";
import type { ProviderContext, FxQuote } from "@/lib/turbocore/providers/interfaces";
import type { Currency } from "@/lib/turbocore/types";

// ─── Whitelist ──────────────────────────────────────────────────────────

export const SUPPORTED_PAIRS = [
  "USD→NGN", "GBP→NGN", "EUR→NGN", "CAD→NGN", "AUD→NGN",
  "USD→GHS", "NGN→USD", "NGN→GBP", "NGN→EUR", "NGN→CAD", "NGN→AUD",
  "USD→KES", "USD→ZAR", "GBP→GHS", "EUR→GHS",
] as const;
export type SupportedPair = (typeof SUPPORTED_PAIRS)[number];
export const pairKey = (from: string, to: string): string => `${from}→${to}`;
export function isPairSupported(from: string, to: string): boolean {
  return (SUPPORTED_PAIRS as readonly string[]).includes(pairKey(from, to));
}

// ─── Constants + defaults ───────────────────────────────────────────────

const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const CONFIG_CACHE_TTL_MS = 60 * 1000;

export interface FxConfigRow {
  id: string; pair: string; fromCurrency: string; toCurrency: string;
  spreadBps: number; platformFeeBps: number;
  minAmountMinor: number; maxAmountMinor: number | null; enabled: boolean;
}

const DEFAULT_CONFIGS: ReadonlyArray<Omit<FxConfigRow, "id">> = [
  { pair: "USD→NGN", fromCurrency: "USD", toCurrency: "NGN", spreadBps: 150, platformFeeBps: 50, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "GBP→NGN", fromCurrency: "GBP", toCurrency: "NGN", spreadBps: 180, platformFeeBps: 60, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "EUR→NGN", fromCurrency: "EUR", toCurrency: "NGN", spreadBps: 170, platformFeeBps: 60, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "CAD→NGN", fromCurrency: "CAD", toCurrency: "NGN", spreadBps: 175, platformFeeBps: 60, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "AUD→NGN", fromCurrency: "AUD", toCurrency: "NGN", spreadBps: 180, platformFeeBps: 60, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "USD→GHS", fromCurrency: "USD", toCurrency: "GHS", spreadBps: 160, platformFeeBps: 50, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "NGN→USD", fromCurrency: "NGN", toCurrency: "USD", spreadBps: 200, platformFeeBps: 80, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "NGN→GBP", fromCurrency: "NGN", toCurrency: "GBP", spreadBps: 210, platformFeeBps: 80, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "NGN→EUR", fromCurrency: "NGN", toCurrency: "EUR", spreadBps: 200, platformFeeBps: 80, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "NGN→CAD", fromCurrency: "NGN", toCurrency: "CAD", spreadBps: 210, platformFeeBps: 80, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "NGN→AUD", fromCurrency: "NGN", toCurrency: "AUD", spreadBps: 215, platformFeeBps: 80, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "USD→KES", fromCurrency: "USD", toCurrency: "KES", spreadBps: 160, platformFeeBps: 50, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "USD→ZAR", fromCurrency: "USD", toCurrency: "ZAR", spreadBps: 155, platformFeeBps: 50, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "GBP→GHS", fromCurrency: "GBP", toCurrency: "GHS", spreadBps: 170, platformFeeBps: 55, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
  { pair: "EUR→GHS", fromCurrency: "EUR", toCurrency: "GHS", spreadBps: 165, platformFeeBps: 55, minAmountMinor: 1_00, maxAmountMinor: null, enabled: true },
];

const configCache = new Map<string, { row: FxConfigRow | null; expiresAt: number }>();
export function _clearFxConfigCacheForTests(): void { configCache.clear(); }

export class FxError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export type FxQuoteResult = FxQuote & {
  destinationAmountMinor: number;
  rawRate: number;
  spreadBps: number;
};

class FxEngine {
  /** Read the FxConfig row for a pair (cached in-memory for 60s). */
  async getSpread(pair: string): Promise<FxConfigRow> {
    const now = Date.now();
    const cached = configCache.get(pair);
    if (cached && cached.expiresAt > now) {
      if (!cached.row) throw new FxError("PAIR_NOT_CONFIGURED", `FX config not found for pair ${pair}`);
      return cached.row;
    }
    const row = await db.fxConfig.findUnique({ where: { pair } });
    const result: FxConfigRow | null = row
      ? {
          id: row.id, pair: row.pair, fromCurrency: row.fromCurrency, toCurrency: row.toCurrency,
          spreadBps: row.spreadBps, platformFeeBps: row.platformFeeBps,
          minAmountMinor: row.minAmountMinor, maxAmountMinor: row.maxAmountMinor, enabled: row.enabled,
        }
      : null;
    configCache.set(pair, { row: result, expiresAt: now + CONFIG_CACHE_TTL_MS });
    if (!result) throw new FxError("PAIR_NOT_CONFIGURED", `FX config not found for pair ${pair}`);
    return result;
  }

  /** Return the most-recent non-expired snapshot for a pair, or null. */
  async getSnapshot(pair: string) {
    return db.fxRateSnapshot.findFirst({
      where: { pair, expiresAt: { gt: new Date() } },
      orderBy: { fetchedAt: "desc" },
    });
  }

  /** Call the provider, store a fresh snapshot, return it. */
  async refreshSnapshot(pair: string, ctx?: ProviderContext) {
    const [from, to] = pair.split("→") as [Currency, Currency];
    const provider = await providers.exchangeRate(ctx);
    const result = await provider.getQuote(from, to, 1_00, ctx);
    if (!result.ok || !result.data) {
      throw new FxError("FX_PROVIDER_FAILED", result.error?.message ?? "FX provider returned no quote");
    }
    return db.fxRateSnapshot.create({
      data: {
        pair,
        rate: result.data.rate,
        providerRef: result.providerRef ?? result.data.rateId ?? null,
        expiresAt: new Date(Date.now() + SNAPSHOT_TTL_MS),
      },
    });
  }

  private async getOrRefreshSnapshot(pair: string, ctx?: ProviderContext) {
    const existing = await this.getSnapshot(pair);
    return existing ?? this.refreshSnapshot(pair, ctx);
  }

  /** Main entry point: validate pair → fresh snapshot → apply spread → fees → audit. */
  async getQuote(
    from: Currency, to: Currency, amountMinor: number,
    opts?: { userId?: string; ctx?: ProviderContext; skipAudit?: boolean },
  ): Promise<FxQuoteResult> {
    const pair = pairKey(from, to);
    if (!isPairSupported(from, to)) {
      throw new FxError("PAIR_NOT_SUPPORTED", `Currency pair ${pair} is not supported`);
    }
    const config = await this.getSpread(pair);
    if (!config.enabled) throw new FxError("PAIR_DISABLED", `Currency pair ${pair} is disabled`);
    if (amountMinor <= 0) throw new FxError("AMOUNT_MUST_BE_POSITIVE", "Amount must be positive");
    if (amountMinor < config.minAmountMinor) {
      throw new FxError("AMOUNT_BELOW_MIN", `Amount below minimum ${config.minAmountMinor}`);
    }
    if (config.maxAmountMinor !== null && amountMinor > config.maxAmountMinor) {
      throw new FxError("AMOUNT_ABOVE_MAX", `Amount above maximum ${config.maxAmountMinor}`);
    }
    const snapshot = await this.getOrRefreshSnapshot(pair, opts?.ctx);
    const rawRate = snapshot.rate;
    // Customer receives a slightly worse rate than mid-market: rate * (1 - spread).
    const quotedRate = rawRate * (1 - config.spreadBps / 10_000);
    const destinationAmountMinor = Math.round(amountMinor * quotedRate);
    const platformFeeMinor = Math.round((amountMinor * config.platformFeeBps) / 10_000);
    if (!opts?.skipAudit) {
      await audit({
        userId: opts?.userId ?? null, action: "FX_QUOTE", category: "FX",
        metadata: { pair, amountMinor, rawRate, quotedRate, spreadBps: config.spreadBps, platformFeeMinor, destinationAmountMinor, snapshotId: snapshot.id },
      });
    }
    return {
      from, to,
      rate: quotedRate,
      rateId: snapshot.id,
      expiresAt: snapshot.expiresAt.toISOString(),
      providerFeeMinor: 0, // provider fee is baked into the spread on our platform
      platformFeeMinor,
      destinationAmountMinor, rawRate, spreadBps: config.spreadBps,
    };
  }

  /**
   * Settlement hook: debits source wallet for `amountMinor`, credits destination
   * wallet for the destination amount (if a distinct `toWalletId` is provided),
   * posts the platform fee as a separate debit, and audits FX_CONVERT.
   */
  async convert(input: {
    userId: string; from: Currency; to: Currency; amountMinor: number;
    fromWalletId: string; toWalletId?: string;
    description?: string; ctx?: ProviderContext;
  }): Promise<{ quote: FxQuoteResult; debitEntryId: string; creditEntryId: string | null; feeEntryId: string | null }> {
    const { userId, from, to, amountMinor, fromWalletId, toWalletId } = input;
    const quote = await this.getQuote(from, to, amountMinor, { userId, ctx: input.ctx });
    const description = input.description ?? `FX conversion ${from}→${to}`;
    const debit = await debitWallet(fromWalletId, amountMinor, "TRANSFER", { description, userId });
    let creditEntryId: string | null = null;
    if (toWalletId && toWalletId !== fromWalletId && quote.destinationAmountMinor > 0) {
      const credit = await creditWallet(toWalletId, quote.destinationAmountMinor, "FUNDING", { description });
      creditEntryId = credit.ledgerEntryId;
    }
    let feeEntryId: string | null = null;
    if (quote.platformFeeMinor > 0) {
      const fee = await debitWallet(fromWalletId, quote.platformFeeMinor, "FEE", { description: `FX platform fee ${from}→${to}`, userId });
      feeEntryId = fee.ledgerEntryId;
    }
    await audit({
      userId, action: "FX_CONVERT", category: "FX",
      metadata: {
        pair: pairKey(from, to), amountMinor,
        destinationAmountMinor: quote.destinationAmountMinor,
        platformFeeMinor: quote.platformFeeMinor, rate: quote.rate, rawRate: quote.rawRate,
        debitEntryId: debit.ledgerEntryId, creditEntryId, feeEntryId,
      },
    });
    return { quote, debitEntryId: debit.ledgerEntryId, creditEntryId, feeEntryId };
  }

  // ─── Admin surface ──────────────────────────────────────────────────

  async listConfigs(): Promise<FxConfigRow[]> {
    const rows = await db.fxConfig.findMany({ orderBy: { pair: "asc" } });
    return rows.map((r) => ({
      id: r.id, pair: r.pair, fromCurrency: r.fromCurrency, toCurrency: r.toCurrency,
      spreadBps: r.spreadBps, platformFeeBps: r.platformFeeBps,
      minAmountMinor: r.minAmountMinor, maxAmountMinor: r.maxAmountMinor, enabled: r.enabled,
    }));
  }

  async upsertConfig(input: {
    pair: string; spreadBps?: number; platformFeeBps?: number;
    minAmountMinor?: number; maxAmountMinor?: number | null; enabled?: boolean;
  }, actor?: { id: string; name: string }): Promise<FxConfigRow> {
    const parts = input.pair.split("→");
    const fromCurrency = parts[0] ?? input.pair.slice(0, 3);
    const toCurrency = parts[1] ?? input.pair.slice(-3);
    const existing = await db.fxConfig.findUnique({ where: { pair: input.pair } }).catch(() => null);
    const row = await db.fxConfig.upsert({
      where: { pair: input.pair },
      create: {
        pair: input.pair, fromCurrency, toCurrency,
        spreadBps: input.spreadBps ?? 150, platformFeeBps: input.platformFeeBps ?? 50,
        minAmountMinor: input.minAmountMinor ?? 0, maxAmountMinor: input.maxAmountMinor ?? null,
        enabled: input.enabled ?? true,
      },
      update: {
        ...(input.spreadBps !== undefined ? { spreadBps: input.spreadBps } : {}),
        ...(input.platformFeeBps !== undefined ? { platformFeeBps: input.platformFeeBps } : {}),
        ...(input.minAmountMinor !== undefined ? { minAmountMinor: input.minAmountMinor } : {}),
        ...(input.maxAmountMinor !== undefined ? { maxAmountMinor: input.maxAmountMinor } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });
    configCache.delete(input.pair);
    await recordConfigVersion("fxConfig", row.id, existing ? "UPDATE" : "CREATE", existing, row, undefined, actor);
    return {
      id: row.id, pair: row.pair, fromCurrency: row.fromCurrency, toCurrency: row.toCurrency,
      spreadBps: row.spreadBps, platformFeeBps: row.platformFeeBps,
      minAmountMinor: row.minAmountMinor, maxAmountMinor: row.maxAmountMinor, enabled: row.enabled,
    };
  }

  async deleteConfig(pair: string, actor?: { id: string; name: string }): Promise<void> {
    const existing = await db.fxConfig.findUnique({ where: { pair } }).catch(() => null);
    await db.fxConfig.deleteMany({ where: { pair } });
    configCache.delete(pair);
    if (existing) await recordConfigVersion("fxConfig", existing.id, "DELETE", existing, null, undefined, actor);
  }
}

export const fx = new FxEngine();

/** Seed default FxConfig rows for all supported pairs (idempotent — no-op if any rows exist). */
export async function seedDefaultFxConfigs(): Promise<void> {
  const count = await db.fxConfig.count();
  if (count > 0) return;
  await db.fxConfig.createMany({ data: DEFAULT_CONFIGS.map((d) => ({ ...d })) });
}
