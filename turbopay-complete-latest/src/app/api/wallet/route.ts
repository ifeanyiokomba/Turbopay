import { db } from "@/lib/db";
import { requireUser } from "@/lib/turbopay/auth";
import { getWalletView, ensureWallet } from "@/lib/turbopay/wallet";
import { features } from "@/lib/turbocore/features";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const wallet = await getWalletView(user.id);
  if (!wallet) return errorJson("Wallet not found", 404);

  let vaccount = await db.virtualAccount.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  // Auto-provision a virtual account if none exists (idempotent).
  let provisioningError: string | null = null;
  if (!vaccount) {
    try {
      const result = await ensureWallet(user.id, `${user.fullName} - Turbopay`);
      vaccount = result.vaccount;
    } catch (e) {
      provisioningError = e instanceof Error ? e.message : "Virtual account provisioning failed. Please try again.";
    }
  }

  const beneficiaries = await db.beneficiary.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  // Feature flag: virtual cards are simulated (test BIN, always-approve).
  // Gate behind flag until a real issuer adapter (Stripe Issuing) lands.
  const cardsEnabled = await features.isEnabled("turbopay.cards", user.id);

  return json({
    data: {
      wallet,
      cardsEnabled,
      virtualAccount: vaccount
        ? {
            id: vaccount.id,
            accountNumber: vaccount.accountNumber,
            accountName: vaccount.accountName,
            bankName: vaccount.bankName,
            bankCode: vaccount.bankCode,
            provider: vaccount.provider,
            status: vaccount.status,
          }
        : null,
      provisioningError,
      beneficiaries: beneficiaries.map((b) => ({
        id: b.id,
        name: b.name,
        accountNumber: b.accountNumber,
        bankName: b.bankName,
        bankCode: b.bankCode,
        type: b.type,
      })),
    },
  });
}
