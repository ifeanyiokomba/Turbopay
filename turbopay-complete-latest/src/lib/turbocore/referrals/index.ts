import * as crypto from "node:crypto";
import { db } from "@/lib/db";
import { generateReference } from "@/lib/turbopay/reference";
import { creditWallet } from "@/lib/turbopay/ledger";
import { audit } from "@/lib/turbopay/audit";

class ReferralService {
  /** Generate a unique referral code for a user. */
  async generateCode(userId: string, fullName: string, campaignId?: string): Promise<string> {
    const base = fullName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) || "TURBO";
    const suffix = crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 4);
    const code = `${base}${suffix}`;
    await db.referral.create({
      data: { referrerId: userId, referralCode: code, status: "PENDING", campaignId: campaignId ?? null },
    });
    return code;
  }

  /** Get a user's referral code (or generate one). */
  async getOrCreateCode(userId: string, fullName: string, campaignId?: string): Promise<string> {
    const existing = await db.referral.findFirst({ where: { referrerId: userId }, orderBy: { createdAt: "desc" } });
    if (existing) return existing.referralCode;
    return this.generateCode(userId, fullName, campaignId);
  }

  /** Look up a referral by code (for referral link handling). */
  async lookupByCode(code: string) {
    return db.referral.findFirst({ where: { referralCode: code.toUpperCase() } });
  }

  /** Complete a referral — called when a referred user signs up. */
  async completeReferral(referralCode: string, referredUserId: string): Promise<void> {
    const referral = await db.referral.findFirst({ where: { referralCode: referralCode.toUpperCase(), status: "PENDING" } });
    if (!referral) return;
    await db.referral.update({ where: { id: referral.id }, data: { referredId: referredUserId, status: "COMPLETED", completedAt: new Date() } });
    // Reward the referrer if configured.
    if (referral.rewardKobo > 0 && referral.rewardType === "WALLET_CREDIT") {
      const wallet = await db.wallet.findUnique({ where: { userId: referral.referrerId } });
      if (wallet) {
        await creditWallet(wallet.id, referral.rewardKobo, "REFERRAL_REWARD", { description: "Referral reward", refId: referral.id });
        await db.referral.update({ where: { id: referral.id }, data: { status: "REWARDED" } });
        await audit({ userId: referral.referrerId, action: "REFERRAL_REWARDED", category: "WALLET", metadata: { referralId: referral.id, rewardKobo: referral.rewardKobo } });
      }
    }
  }

  /** Get referral stats for a user. */
  async getStats(userId: string) {
    const referrals = await db.referral.findMany({ where: { referrerId: userId }, orderBy: { createdAt: "desc" } });
    const completed = referrals.filter(r => r.status === "COMPLETED" || r.status === "REWARDED").length;
    const rewarded = referrals.filter(r => r.status === "REWARDED").length;
    const totalEarnings = referrals.filter(r => r.status === "REWARDED").reduce((a, r) => a + r.rewardKobo, 0);
    return { total: referrals.length, completed, rewarded, totalEarningsKobo: totalEarnings, referrals };
  }

  /** List all referrals (admin view). */
  async listAll(page = 1, limit = 50) {
    const [items, total] = await Promise.all([
      db.referral.findMany({ orderBy: { createdAt: "desc" }, take: limit, skip: (page - 1) * limit, include: { referrer: { select: { fullName: true, email: true } } } }),
      db.referral.count(),
    ]);
    return { items, total, page, limit };
  }

  /** Create a referral campaign (admin). */
  async createCampaign(name: string, rewardKobo: number, rewardType: string, opts?: { description?: string; maxReferrals?: number; startDate?: Date; endDate?: Date }) {
    return db.referralCampaign.create({ data: { name, description: opts?.description, rewardKobo, rewardType, maxReferrals: opts?.maxReferrals ?? 0, startDate: opts?.startDate, endDate: opts?.endDate } });
  }

  async listCampaigns() { return db.referralCampaign.findMany({ orderBy: { createdAt: "desc" } }); }
}

export const referrals = new ReferralService();
