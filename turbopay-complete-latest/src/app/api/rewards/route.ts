import { requireUser } from "@/lib/turbopay/auth";
import { db } from "@/lib/db";
import { errorJson, json } from "@/lib/turbopay/api";
import { rewards } from "@/lib/turbocore/rewards";

/**
 * GET /api/rewards
 * Returns the authenticated user's rewards (all types) plus voucher
 * redemption history plus an aggregate summary (total cashback, tier
 * bonuses, campaign rewards, referral bonuses, vouchers).
 */
export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (e: unknown) {
    const err = e as { message?: string; status?: number; code?: string };
    return errorJson(err.message ?? "Unauthorized", err.status ?? 401, err.code);
  }

  const [rewardsList, voucherHistory, summary] = await Promise.all([
    db.userReward.findMany({
      where: { userId: user.id },
      include: { voucher: true },
      orderBy: { createdAt: "desc" },
    }),
    db.voucherRedemption.findMany({
      where: { userId: user.id },
      include: { voucher: true },
      orderBy: { createdAt: "desc" },
    }),
    rewards.getSummary(user.id),
  ]);

  return json({ data: { rewards: rewardsList, voucherHistory, summary } });
}
