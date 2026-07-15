import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { referrals } from "@/lib/turbocore/referrals";
import { z } from "zod";

const schema = z.object({
  code: z.string().min(4).max(20),
});

/**
 * POST /api/referrals/lookup — look up a referral by code.
 *
 * Public endpoint for referral link handling. Returns referrer info
 * if the code exists, so the client can show "Referred by X" during signup.
 */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "referral-lookup", limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const referral = await referrals.lookupByCode(parsed.data.code);
  if (!referral) return errorJson("Invalid referral code", 404, "NOT_FOUND");

  return json({
    data: {
      referralCode: referral.referralCode,
      referrerId: referral.referrerId,
      campaignId: referral.campaignId,
      rewardKobo: referral.rewardKobo,
      rewardType: referral.rewardType,
    },
  });
}
