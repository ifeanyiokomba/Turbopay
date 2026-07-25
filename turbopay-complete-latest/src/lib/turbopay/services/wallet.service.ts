/**
 * Turbopay Service Layer — WalletService.
 * ========================================
 *
 * Read-side wallet view (balance + virtual account + beneficiaries) and the
 * demo funding flow (simulates a Monnify webhook → processFunding).
 *
 * Extracted from:
 *   - src/app/api/wallet/route.ts       GET  → getWallet
 *   - src/app/api/wallet/fund/route.ts  POST → fund
 */

import { db } from "@/lib/db";
import { getWalletView } from "@/lib/turbopay/wallet";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { providers } from "@/lib/turbocore/providers/registry";
import { features } from "@/lib/turbocore/features";
import { notify } from "@/lib/turbocore/notifications";
import { processFunding } from "@/lib/turbopay/funding";
import { nairaToKobo } from "@/lib/turbopay/money";
import { decryptPii } from "@/lib/turbopay/crypto";
import { ServiceError } from "./types";
import type { FundWalletInput, FundWalletResult, GetWalletResult } from "./types";

class WalletService {
  /**
   * Get the user's wallet view (balance, ledger reconciliation, virtual
   * funding account, and saved beneficiaries). Mirrors the original
   * GET /api/wallet handler bit-for-bit.
   */
  async getWallet(userId: string): Promise<GetWalletResult> {
    const wallet = await getWalletView(userId);
    if (!wallet) throw new ServiceError("WALLET_NOT_FOUND", "Wallet not found", 404);

    let vaccount = await db.virtualAccount.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });

    // Auto-provision a virtual account if none exists (idempotent).
    let provisioningError: string | null = null;
    if (!vaccount) {
      try {
        const user = await db.user.findUnique({ where: { id: userId } });
        if (user) {
          const result = await ensureWallet(userId, `${user.fullName} - Turbopay`);
          vaccount = result.vaccount;
        }
      } catch (e) {
        provisioningError = e instanceof Error ? e.message : "Virtual account provisioning failed. Please try again.";
      }
    }

    const beneficiaries = await db.beneficiary.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    const cardsEnabled = await features.isEnabled("turbopay.cards", userId);

    return {
      wallet,
      cardsEnabled,
      provisioningError,
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
      beneficiaries: beneficiaries.map((b) => ({
        id: b.id,
        name: b.name,
        accountNumber: b.accountNumber,
        bankName: b.bankName,
        bankCode: b.bankCode,
        type: b.type,
      })),
    };
  }

  /**
   * Demo funding flow: simulates the user transferring money into their
   * Monnify reserved account. Synthesises the Monnify webhook payload and
   * runs it through the same idempotent processFunding path the real webhook
   * uses — so the ledger behaves exactly as in production.
   *
   * (Route-level rate limiting of 10/hour is enforced by the caller.)
   */
  async fund(input: FundWalletInput): Promise<FundWalletResult> {
    const { user, amountNaira } = input;

    let va = await db.virtualAccount.findFirst({ where: { userId: user.id, status: "ACTIVE" } });

    // Auto-provision a virtual account if none exists.
    if (!va) {
      try {
        const result = await ensureWallet(user.id, `${user.fullName} - Turbopay`);
        va = result.vaccount;
      } catch {
        throw new ServiceError(
          "VIRTUAL_ACCOUNT_PROVISIONING",
          "Your virtual account is being set up. Please try again in a few moments.",
          503,
        );
      }
    }

    if (!va) {
      throw new ServiceError(
        "VIRTUAL_ACCOUNT_NOT_FOUND",
        "Unable to set up your virtual account. Please contact support.",
        500,
      );
    }

    const wf = await providers.walletFunding();
    const simulated = await wf.simulateFunding(va.accountNumber, nairaToKobo(amountNaira));
    const providerRef = simulated.payload.transactionReference;
    const paymentReference = simulated.payload.paymentReference;

    const result = await processFunding({
      accountNumber: va.accountNumber,
      amountKobo: nairaToKobo(amountNaira),
      providerRef,
      paymentReference,
      description: `Wallet funding — ${va.bankName}`,
    });

    if (!result.credited && result.reason === "DUPLICATE_WEBHOOK") {
      throw new ServiceError("DUPLICATE", "This funding was already processed", 409);
    }

    // Fire-and-forget in-app notification on success.
    if (result.credited) {
      notify
        .sendInApp({
          userId: user.id,
          type: "TRANSACTION",
          title: "Wallet Funded",
          message: `₦${amountNaira.toLocaleString()} added via ${va.bankName} · Ref: ${providerRef}`,
          actionUrl: "/history",
          actionLabel: "View receipt",
        })
        .catch(() => null);
    }

    return { ok: true, transactionId: result.transactionId, amountNaira };
  }

  /**
   * Initialize a Paystack transaction for wallet funding.
   * Returns the authorization URL for redirect to Paystack checkout.
   */
  async fundViaPaystack(userId: string, amountNaira: number): Promise<{ reference: string; authorizationUrl: string; accessCode: string }> {
    // Get Paystack credentials from the provider config.
    const config = await db.providerConfig.findFirst({
      where: { providerName: "paystack", enabled: true, contract: "walletFunding" },
    });
    if (!config) throw new ServiceError("PROVIDER_NOT_CONFIGURED", "Paystack is not configured. Please contact support.", 400);

    let secretKey: string;
    try {
      if (!config.credentialsEnc) throw new Error("No credentials configured");
      const creds = JSON.parse(decryptPii(config.credentialsEnc));
      secretKey = creds.secretKey;
      if (!secretKey) throw new Error("Missing secretKey");
    } catch {
      throw new ServiceError("CREDENTIALS_ERROR", "Paystack credentials are invalid. Please reconfigure.", 500);
    }

    // Resolve virtual account for the webhook handler to credit the correct wallet.
    const va = await db.virtualAccount.findFirst({ where: { userId, status: "ACTIVE" } });

    const amountKobo = Math.round(amountNaira * 100);
    const reference = `tp_paystack_${userId}_${Date.now()}`;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    // Initialize Paystack transaction.
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountKobo,
        email: `${userId}@turbopay.com`,
        reference,
        currency: "NGN",
        callback_url: `${appUrl}/wallet?payment=success&provider=paystack&ref=${reference}`,
        metadata: {
          userId,
          accountNumber: va?.accountNumber ?? "",
          reference,
          integration: "turbopay",
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new ServiceError("PAYSTACK_ERROR", `Paystack error: ${errBody}`, 502);
    }

    const data = await res.json() as any;
    if (!data.status || !data.data?.authorization_url) {
      throw new ServiceError("PAYSTACK_ERROR", data.message ?? "Failed to initialize payment", 502);
    }

    return {
      reference: data.data.reference,
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
    };
  }
}

export const walletService = new WalletService();
