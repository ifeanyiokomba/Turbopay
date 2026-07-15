import { requireUser } from "@/lib/turbopay/auth";
import { verifyTransactionPin } from "@/lib/turbopay/pin";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { sendInternationalTransfer } from "@/lib/turbocore/international/send";
import { z } from "zod";

const schema = z.object({
  sourceCurrency: z.enum(["NGN", "USD", "EUR", "GBP", "CAD", "AUD", "KES", "GHS", "ZAR"]),
  destinationCurrency: z.enum(["NGN", "USD", "EUR", "GBP", "CAD", "AUD", "KES", "GHS", "ZAR"]),
  amountMinor: z.number().int().positive().max(500_000_000), // Max 5M units
  beneficiary: z.object({
    name: z.string().min(1).max(200),
    account: z.string().optional(),
    bank: z.string().optional(),
    country: z.string().min(2).max(3),
    routingCode: z.string().optional(),
  }),
  purpose: z.string().min(3).max(500),
  pin: z.string().regex(/^\d{4}$/, "Transaction PIN must be 4 digits"),
});

/**
 * POST /api/intl/send — Send an outbound international transfer.
 *
 * Requires:
 *   - Authenticated session
 *   - Transaction PIN
 *   - Feature flag "turbopay.intl" enabled
 *   - Sufficient balance (amount + fees)
 *   - KYC tier limits
 *   - AML clearance
 */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "intl-send", limit: 3, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  // Verify transaction PIN
  const pinResult = await verifyTransactionPin(user, parsed.data.pin);
  if (!pinResult.ok) {
    return errorJson(pinResult.error ?? "Invalid PIN", 400, pinResult.code);
  }

  // Get user's wallet
  const { db } = await import("@/lib/db");
  const wallet = await db.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet) return errorJson("Wallet not found", 404, "WALLET_NOT_FOUND");
  if (wallet.status !== "ACTIVE") return errorJson("Wallet is frozen", 403, "WALLET_FROZEN");

  const result = await sendInternationalTransfer({
    userId: user.id,
    walletId: wallet.id,
    kycTier: user.kycTier,
    sourceCurrency: parsed.data.sourceCurrency,
    destinationCurrency: parsed.data.destinationCurrency,
    amountMinor: parsed.data.amountMinor,
    beneficiary: parsed.data.beneficiary,
    purpose: parsed.data.purpose,
  });

  if (!result.success) {
    return errorJson(result.error ?? "Transfer failed", 400, result.errorCode ?? "TRANSFER_FAILED");
  }

  return json({
    data: {
      transactionId: result.transactionId,
      reference: result.reference,
      providerRef: result.providerRef,
      quotedRate: result.quotedRate,
      destinationAmountMinor: result.destinationAmountMinor,
      feesMinor: result.feesMinor,
      sourceCurrency: parsed.data.sourceCurrency,
      destinationCurrency: parsed.data.destinationCurrency,
      beneficiary: parsed.data.beneficiary,
    },
  });
}
