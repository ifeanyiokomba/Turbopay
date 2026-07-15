import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";

const ELIGIBLE_PRODUCTS = [
  "AIRTIME", "DATA", "BILL_ELECTRICITY", "BILL_UTILITY", "INTERNET", "CABLE_TV",
  "TRANSFER_FEE", "VIRTUAL_CARD", "SAVINGS", "REMITA", "QUICKTELLER",
] as const;

const EXCLUDED_PRODUCTS = [
  "WALLET_FUNDING", "WITHDRAWAL", "REGULATORY_CHARGE", "TAX", "GOVERNMENT_CHARGE",
] as const;

export interface VoucherValidationResult {
  valid: boolean;
  reason?: string;
  discountKobo?: number;
}

class VoucherService {
  /** Validate a voucher against a specific transaction context. */
  async validate(code: string, ctx: { userId: string; product: string; amountKobo: number; kycTier: number; isNewUser?: boolean }): Promise<VoucherValidationResult> {
    const voucher = await db.voucher.findUnique({ where: { code: code.toUpperCase() }, include: { redemptions: true } });
    if (!voucher) return { valid: false, reason: "Voucher not found" };
    if (!voucher.active) return { valid: false, reason: "Voucher is no longer active" };
    if (voucher.endDate && voucher.endDate < new Date()) return { valid: false, reason: "Voucher has expired" };
    if (voucher.startDate && voucher.startDate > new Date()) return { valid: false, reason: "Voucher is not yet active" };

    // Product eligibility
    const eligible = voucher.eligibleProducts ? JSON.parse(voucher.eligibleProducts) : ELIGIBLE_PRODUCTS;
    if (!eligible.includes(ctx.product)) return { valid: false, reason: `Voucher is not valid for ${ctx.product}` };
    const excluded = voucher.excludedProducts ? JSON.parse(voucher.excludedProducts) : EXCLUDED_PRODUCTS;
    if (excluded.includes(ctx.product)) return { valid: false, reason: `Voucher cannot be used for ${ctx.product}` };

    // Minimum spend
    if (ctx.amountKobo < voucher.minSpendKobo) return { valid: false, reason: `Minimum spend is ₦${voucher.minSpendKobo / 100}` };

    // KYC tier
    if (voucher.applicableKycTiers) {
      const tiers = JSON.parse(voucher.applicableKycTiers);
      if (!tiers.includes(ctx.kycTier)) return { valid: false, reason: `Voucher requires KYC Tier ${tiers.join(" or ")}` };
    }

    // New/returning customer
    if (voucher.newCustomerOnly && !ctx.isNewUser) return { valid: false, reason: "Voucher is for new customers only" };
    if (voucher.returningOnly && ctx.isNewUser) return { valid: false, reason: "Voucher is for returning customers only" };

    // Usage limits
    if (voucher.usageLimit > 0 && voucher.totalUsed >= voucher.usageLimit) return { valid: false, reason: "Voucher usage limit reached" };
    const userRedemptions = voucher.redemptions.filter(r => r.userId === ctx.userId && r.status === "SUCCESS");
    if (voucher.perUserLimit > 0 && userRedemptions.length >= voucher.perUserLimit) return { valid: false, reason: "You have reached the usage limit for this voucher" };

    // Campaign budget
    if (voucher.campaignBudgetKobo && voucher.totalDiscountKobo >= voucher.campaignBudgetKobo) return { valid: false, reason: "Campaign budget exhausted" };

    // Calculate discount
    let discount = 0;
    if (voucher.type === "FLAT_OFF") discount = voucher.valueKobo;
    else if (voucher.type === "PERCENT_OFF") discount = Math.round((ctx.amountKobo * voucher.valueBps) / 10000);
    else if (voucher.type === "FEE_WAIVER") discount = voucher.valueKobo; // waive a specific fee
    if (voucher.maxDiscountKobo && discount > voucher.maxDiscountKobo) discount = voucher.maxDiscountKobo;
    if (discount > ctx.amountKobo) discount = ctx.amountKobo; // never exceed the transaction amount

    return { valid: true, discountKobo: discount };
  }

  /** Redeem a voucher — records the redemption + updates tracking counters. */
  async redeem(code: string, ctx: { userId: string; transactionId: string; product: string; amountKobo: number; kycTier: number }): Promise<{ redeemed: boolean; discountKobo: number; reason?: string }> {
    const validation = await this.validate(code, ctx);
    if (!validation.valid || !validation.discountKobo) return { redeemed: false, discountKobo: 0, reason: validation.reason };

    const voucher = await db.voucher.findUnique({ where: { code: code.toUpperCase() } });
    if (!voucher) return { redeemed: false, discountKobo: 0, reason: "Voucher not found" };

    await db.$transaction([
      db.voucherRedemption.create({
        data: { voucherId: voucher.id, userId: ctx.userId, transactionId: ctx.transactionId, discountAppliedKobo: validation.discountKobo, status: "SUCCESS" },
      }),
      db.voucher.update({
        where: { id: voucher.id },
        data: { totalUsed: { increment: 1 }, totalDiscountKobo: { increment: validation.discountKobo } },
      }),
    ]);

    await audit({ userId: ctx.userId, action: "VOUCHER_REDEEMED", category: "WALLET", metadata: { code, discountKobo: validation.discountKobo, transactionId: ctx.transactionId } });
    return { redeemed: true, discountKobo: validation.discountKobo };
  }

  /** Get vouchers available for a user. */
  async getAvailableForUser(userId: string) {
    const rewards = await db.userReward.findMany({ where: { userId, status: "AVAILABLE" }, include: { voucher: true }, orderBy: { createdAt: "desc" } });
    const activeVouchers = await db.voucher.findMany({ where: { active: true, endDate: { gt: new Date() } }, orderBy: { endDate: "asc" } });
    return { rewards, activeVouchers };
  }

  /** Get voucher redemption history for a user. */
  async getUserHistory(userId: string) {
    return db.voucherRedemption.findMany({ where: { userId }, include: { voucher: true }, orderBy: { createdAt: "desc" } });
  }

  // Admin methods
  async create(input: { code: string; campaignName: string; type: string; valueKobo?: number; valueBps?: number; maxDiscountKobo?: number; minSpendKobo?: number; eligibleProducts?: string[]; excludedProducts?: string[]; applicableKycTiers?: number[]; newCustomerOnly?: boolean; returningOnly?: boolean; referralRequired?: boolean; oneTimeUse?: boolean; usageLimit?: number; perUserLimit?: number; campaignBudgetKobo?: number; startDate?: Date; endDate?: Date; currencyRestriction?: string; regionRestriction?: string; providerRestriction?: string; }) {
    return db.voucher.create({
      data: {
        code: input.code.toUpperCase(), campaignName: input.campaignName, type: input.type,
        valueKobo: input.valueKobo ?? 0, valueBps: input.valueBps ?? 0, maxDiscountKobo: input.maxDiscountKobo,
        minSpendKobo: input.minSpendKobo ?? 0,
        eligibleProducts: input.eligibleProducts ? JSON.stringify(input.eligibleProducts) : null,
        excludedProducts: input.excludedProducts ? JSON.stringify(input.excludedProducts) : null,
        applicableKycTiers: input.applicableKycTiers ? JSON.stringify(input.applicableKycTiers) : null,
        newCustomerOnly: input.newCustomerOnly ?? false, returningOnly: input.returningOnly ?? false,
        referralRequired: input.referralRequired ?? false, oneTimeUse: input.oneTimeUse ?? true,
        usageLimit: input.usageLimit ?? 0, perUserLimit: input.perUserLimit ?? 1,
        campaignBudgetKobo: input.campaignBudgetKobo, startDate: input.startDate, endDate: input.endDate,
        currencyRestriction: input.currencyRestriction, regionRestriction: input.regionRestriction, providerRestriction: input.providerRestriction,
      },
    });
  }

  async list() { return db.voucher.findMany({ orderBy: { createdAt: "desc" } }); }
  async update(id: string, data: Record<string, unknown>) { return db.voucher.update({ where: { id }, data }); }
  async delete(id: string) { return db.voucher.update({ where: { id }, data: { active: false } }); }
}

export const vouchers = new VoucherService();
export { ELIGIBLE_PRODUCTS, EXCLUDED_PRODUCTS };
