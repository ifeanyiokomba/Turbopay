import { db } from "@/lib/db";
import { requireUser, readIp } from "@/lib/turbopay/auth";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";

/**
 * GET /api/profile/export
 * Returns a JSON dump of the authenticated user's personal data:
 * profile, wallet, KYC records, and recent transactions.
 *
 * NDPR / data-portability compliance: the user has a right to receive a copy
 * of their data in a structured, machine-readable format. The response is
 * returned as JSON (which the client renders/downloads as a file).
 */
export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const [profile, wallet, kycRecords, transactions, virtualAccounts, virtualCards, savings, investments, disputes, scheduledPayments, referrals, rewards] = await Promise.all([
    db.user.findUnique({
      where: { id: user.id },
      select: {
        id: true, fullName: true, username: true, email: true, phone: true,
        kycTier: true, kycStatus: true, status: true, role: true,
        emailVerified: true, phoneVerified: true, avatarUrl: true, bio: true,
        // PII fields (BVN/NIN) are intentionally excluded — they are
        // encrypted at rest and should never be exported in cleartext.
        // dateOfBirth / gender / stateOfOrigin / lga / town ARE included
        // (they are user-visible profile fields, not identity numbers).
        dateOfBirth: true, gender: true, stateOfOrigin: true, lga: true, town: true,
        createdAt: true, updatedAt: true,
      },
    }),
    db.wallet.findUnique({ where: { userId: user.id } }),
    db.kycVerification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, tier: true, status: true, provider: true, createdAt: true, verifiedAt: true } }),
    db.transaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 500 }),
    db.virtualAccount.findMany({ where: { userId: user.id }, select: { id: true, accountNumber: true, accountName: true, bankName: true, bankCode: true, provider: true, status: true, createdAt: true } }),
    db.virtualCard.findMany({ where: { userId: user.id }, select: { id: true, type: true, status: true, last4: true, brand: true, balanceKobo: true, provider: true, createdAt: true } }),
    db.savingsProduct.findMany({ where: { userId: user.id }, select: { id: true, name: true, type: true, currentAmountKobo: true, targetAmountKobo: true, status: true, createdAt: true } }),
    db.userInvestment.findMany({ where: { userId: user.id }, select: { id: true, amountKobo: true, status: true, createdAt: true, maturityDate: true, investmentProductId: true } }),
    db.dispute.findMany({ where: { userId: user.id }, select: { id: true, disputeNumber: true, type: true, subject: true, status: true, priority: true, createdAt: true, resolvedAt: true } }),
    db.scheduledPayment.findMany({ where: { userId: user.id }, select: { id: true, type: true, frequency: true, recipient: true, amountKobo: true, status: true, nextExecutionAt: true, createdAt: true } }),
    db.referral.findMany({ where: { referrerId: user.id }, select: { id: true, referralCode: true, status: true, rewardKobo: true, createdAt: true, completedAt: true } }),
    db.userReward.findMany({ where: { userId: user.id }, select: { id: true, type: true, title: true, valueKobo: true, status: true, createdAt: true } }),
  ]);

  await audit({
    userId: user.id,
    action: "PROFILE_DATA_EXPORTED",
    category: "AUTH",
    ip: readIp(new Headers()),
    metadata: { txCount: transactions.length },
  });

  return json({
    data: {
      exportedAt: new Date().toISOString(),
      profile,
      wallet,
      kycRecords,
      transactions,
      virtualAccounts,
      virtualCards,
      savings,
      investments,
      disputes,
      scheduledPayments,
      referrals,
      rewards,
    },
  });
}
