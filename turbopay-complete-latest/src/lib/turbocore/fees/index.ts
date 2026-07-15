/**
 * TurboCore — Complete Fee Engine
 * =================================
 *
 * Fully configurable fee management. Supports:
 *   - Fixed fees (FLAT)
 *   - Percentage fees (PERCENT — basis points, 100 = 1%)
 *   - Tiered fees (TIERED — JSON array of { upTo, fee } in metadata)
 *   - Minimum and maximum fee caps
 *   - Customer category pricing (Tier 3 gets discounts, etc.)
 *   - KYC tier-based discounts
 *   - Promotional pricing (time-based via startDate/endDate in metadata)
 *
 * No fee calculations are hardcoded — everything is DB-driven.
 *
 * Usage:
 *   const fee = await fees.calculate("turbopay", "BILL_ELECTRICITY", amountKobo, { kycTier: 3 });
 */

import { db } from "@/lib/db";
import { recordConfigVersion } from "@/lib/turbocore/config/versioning";

export interface FeeCalcContext {
  kycTier?: number;
  customerCategory?: string; // PREMIUM | STANDARD | STUDENT | etc.
  promotionCode?: string;
  region?: string;
  provider?: string;
}

export interface FeeResult {
  feeMinor: number;
  type: string;
  currency: string;
  configId: string;
  originalFeeMinor?: number; // before discount
  discountApplied?: string;
}

class FeeService {
  /**
   * Calculate the fee for a given product + category + amount.
   * Optionally applies KYC tier discounts and promotional pricing.
   */
  async calculate(product: string, category: string, amountMinor: number, ctx?: FeeCalcContext): Promise<FeeResult> {
    const config = await db.feeConfig.findFirst({ where: { product, category, active: true } });
    if (!config) return { feeMinor: 0, type: "NONE", currency: "NGN", configId: "none" };

    let fee = 0;
    switch (config.type) {
      case "PERCENT":
        fee = Math.round((amountMinor * config.value) / 10000);
        break;
      case "FLAT":
        fee = config.value;
        break;
      case "TIERED": {
        // TIERED is stored as a JSON array of { upTo, fee } in metadata.
        try {
          const tiers = config.metadata ? JSON.parse(config.metadata) : [];
          if (Array.isArray(tiers) && tiers.length > 0) {
            const tier = tiers.find((t: any) => amountMinor <= t.upTo) ?? tiers[tiers.length - 1];
            fee = tier.fee ?? 0;
          } else {
            fee = config.value; // fallback to flat if no tiers
          }
        } catch {
          fee = config.value;
        }
        break;
      }
      default:
        fee = 0;
    }

    // Apply min/max caps.
    if (fee < config.minFeeMinor) fee = config.minFeeMinor;
    if (config.maxFeeMinor !== null && fee > config.maxFeeMinor) fee = config.maxFeeMinor;

    // ─── Market Percent (Platform Markup) ─────────────────────
    // Add the platform's margin on top of the base fee.
    if (config.markupBps > 0) {
      const markup = Math.round((amountMinor * config.markupBps) / 10000);
      fee += markup;
    }

    const originalFee = fee;

    // ─── KYC Tier Discount ──────────────────────────────────
    // Tier 3 users may receive configurable fee discounts for selected categories.
    if (ctx?.kycTier === 3) {
      const discountConfig = await db.feeConfig.findFirst({
        where: { product, category: `${category}_TIER3_DISCOUNT`, active: true },
      });
      if (discountConfig) {
        const discountBps = discountConfig.value; // basis points to discount
        const discount = Math.round((fee * discountBps) / 10000);
        fee = Math.max(0, fee - discount);
      }
    }

    // ─── Customer Category Pricing ──────────────────────────
    if (ctx?.customerCategory) {
      const categoryConfig = await db.feeConfig.findFirst({
        where: { product, category: `${category}_${ctx.customerCategory}`, active: true },
      });
      if (categoryConfig) {
        // Override with category-specific fee
        if (categoryConfig.type === "PERCENT") fee = Math.round((amountMinor * categoryConfig.value) / 10000);
        else fee = categoryConfig.value;
      }
    }

    // ─── Region-Based Pricing ──────────────────────────────
    // Region-specific overrides (e.g. USD transfers cost differently than NGN).
    if (ctx?.region) {
      const regionConfig = await db.feeConfig.findFirst({
        where: { product, category: `${category}_${ctx.region.toUpperCase()}`, active: true },
      });
      if (regionConfig) {
        if (regionConfig.type === "PERCENT") fee = Math.round((amountMinor * regionConfig.value) / 10000);
        else fee = regionConfig.value;
      }
    }

    // ─── Promotion Code ────────────────────────────────────
    // Time-based promotional pricing. The fee config for the promotion is
    // looked up as {product}_{category}_PROMO_{code}. The promotion entry's
    // metadata contains JSON with optional startDate/endDate. If the current
    // time falls outside the window, the promotion is ignored.
    if (ctx?.promotionCode) {
      const promoConfig = await db.feeConfig.findFirst({
        where: { product, category: `${category}_PROMO_${ctx.promotionCode.toUpperCase()}`, active: true },
      });
      if (promoConfig) {
        // Check time window if present.
        let inWindow = true;
        try {
          const meta = promoConfig.metadata ? JSON.parse(promoConfig.metadata) : {};
          if (meta.startDate && new Date(meta.startDate) > new Date()) inWindow = false;
          if (meta.endDate && new Date(meta.endDate) < new Date()) inWindow = false;
        } catch { /* no metadata or invalid JSON — treat as always active */ }
        if (inWindow) {
          const originalBeforePromo = fee;
          if (promoConfig.type === "PERCENT") fee = Math.round((amountMinor * promoConfig.value) / 10000);
          else fee = promoConfig.value;
          if (fee !== originalBeforePromo) {
            return {
              feeMinor: Math.max(0, fee),
              type: promoConfig.type,
              currency: config.currency,
              configId: promoConfig.id,
              originalFeeMinor: originalFee,
              discountApplied: `PROMO_${ctx.promotionCode.toUpperCase()}`,
            };
          }
        }
      }
    }

    return {
      feeMinor: fee,
      type: config.type,
      currency: config.currency,
      configId: config.id,
      originalFeeMinor: fee !== originalFee ? originalFee : undefined,
      discountApplied: fee !== originalFee ? "TIER3_DISCOUNT" : undefined,
    };
  }

  /** Set/update a fee config. */
  async set(product: string, category: string, opts: { type: "PERCENT" | "FLAT" | "TIERED"; value: number; markupBps?: number; minFeeMinor?: number; maxFeeMinor?: number | null; metadata?: string }, actor?: { id: string; name: string }) {
    const existing = await db.feeConfig.findUnique({ where: { product_category: { product, category } } }).catch(() => null);
    const result = await db.feeConfig.upsert({
      where: { product_category: { product, category } },
      create: { product, category, type: opts.type, value: opts.value, markupBps: opts.markupBps ?? 0, minFeeMinor: opts.minFeeMinor ?? 0, maxFeeMinor: opts.maxFeeMinor ?? null, metadata: opts.metadata },
      update: { type: opts.type, value: opts.value, markupBps: opts.markupBps ?? 0, minFeeMinor: opts.minFeeMinor ?? 0, maxFeeMinor: opts.maxFeeMinor ?? null, metadata: opts.metadata, active: true },
    });
    await recordConfigVersion("feeConfig", result.id, existing ? "UPDATE" : "CREATE", existing, result, undefined, actor);
    return result;
  }

  async list(product?: string) {
    return db.feeConfig.findMany({ where: product ? { product } : undefined, orderBy: [{ product: "asc" }, { category: "asc" }] });
  }

  async delete(id: string, actor?: { id: string; name: string }) {
    const existing = await db.feeConfig.findUnique({ where: { id } });
    const result = await db.feeConfig.update({ where: { id }, data: { active: false } });
    await recordConfigVersion("feeConfig", id, "DELETE", existing, result, undefined, actor);
    return result;
  }
}

export const fees = new FeeService();

/** Seed default fees if none exist. Call at app boot. */
export async function seedDefaultFees() {
  const count = await db.feeConfig.count();
  if (count > 0) return;
  await db.feeConfig.createMany({
    data: [
      { product: "turbopay", category: "TRANSFER", type: "FLAT", value: 0, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "AIRTIME", type: "PERCENT", value: 50, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "DATA", type: "PERCENT", value: 50, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "BILL_ELECTRICITY", type: "FLAT", value: 10000, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "BILL_UTILITY", type: "FLAT", value: 5000, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "WALLET_FUNDING", type: "FLAT", value: 0, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "WITHDRAWAL", type: "PERCENT", value: 100, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "INTL_TRANSFER", type: "PERCENT", value: 150, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "INTL_RECEIVING", type: "FLAT", value: 0, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "REMITA", type: "PERCENT", value: 50, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "QUICKTELLER", type: "PERCENT", value: 50, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "VIRTUAL_CARD", type: "FLAT", value: 100000, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "SAVINGS", type: "FLAT", value: 0, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "turbopay", category: "INVESTMENT", type: "PERCENT", value: 50, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "billswift", category: "BILL_ELECTRICITY", type: "PERCENT", value: 100, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      { product: "billswift", category: "BILL_UTILITY", type: "PERCENT", value: 100, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      // Tier 3 discount for Remita (50% off)
      { product: "turbopay", category: "REMITA_TIER3_DISCOUNT", type: "PERCENT", value: 5000, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
      // Tier 3 discount for Quickteller (50% off)
      { product: "turbopay", category: "QUICKTELLER_TIER3_DISCOUNT", type: "PERCENT", value: 5000, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN", active: true },
    ],
  });
}
