import { db } from "@/lib/db";
import { requireUser, readIp } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { verifyTransactionPin } from "@/lib/turbopay/pin";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { executeProviderDebit } from "@/lib/turbopay/payments";
import { providers } from "@/lib/turbocore/providers/registry";
import { fees } from "@/lib/turbocore/fees";
import { nairaToKobo } from "@/lib/turbopay/money";
import { generateReference } from "@/lib/turbopay/reference";
import { z } from "zod";

/**
 * POST /api/billswift/pay — pay a single bill via the BillSwift domain service.
 *
 * This is the HTTP entrypoint for `billswift.payBill()` (the audit found the
 * method existed but had no route). It mirrors the structure of the existing
 * Turbopay `/api/bills/utilities` route but delegates the hold+confirm+reverse
 * orchestration to the BillSwift domain service via `executeProviderDebit`:
 *
 *   1. requireUser() — authenticated caller.
 *   2. Zod-validate the body.
 *   3. Rate-limit PIN attempts (10/min per user) — brute-force defense.
 *   4. Verify the transaction PIN (debit-side second factor).
 *   5. Wallet status + balance + AML `checkDebit` (KYC tier limits + velocity).
 *   6. `executeProviderDebit` with type=BILL_UTILITY, refType=BILL,
 *      provider="billswift" + a `providerCall` that delegates to the active
 *      IBillPaymentProvider (resolved through the TurboCore registry).
 *   7. Audit the payment.
 *   8. Return { ok, reference, providerRef, newBalanceKobo }.
 */

const schema = z.object({
  productCode: z.string().min(2, "Product code is required"),
  customer: z.string().min(4, "Customer reference is required"),
  customerName: z.string().min(2, "Customer name is required"),
  productName: z.string().min(2, "Product name is required"),
  category: z.string().min(2, "Category is required"),
  amountNaira: z
    .number()
    .min(100, "Minimum is ₦100")
    .max(200000, "Maximum is ₦200,000"),
  meterType: z.enum(["PREPAID", "POSTPAID"]).optional(),
  pin: z.string().regex(/^\d{4}$/, "Transaction PIN is required"),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      parsed.error.issues[0]?.message ?? "Invalid input",
      422,
      "VALIDATION"
    );
  }
  const input = parsed.data;
  const amountKobo = nairaToKobo(input.amountNaira);

  // Per-user rate limit on PIN attempts — brute-force defense.
  const limited = await rateLimit(req, {
    key: "pin",
    limit: 10,
    windowMs: 60_000,
    scope: "user",
    userId: user.id,
  });
  if (limited) return limited;

  // Transaction PIN required — every debit must be second-factored.
  const pinCheck = await verifyTransactionPin(user, input.pin);
  if (!pinCheck.ok) return errorJson(pinCheck.error!, 400, pinCheck.code);

  // Calculate fee from the fee engine
  const feeResult = await fees.calculate("turbopay", "BILL_UTILITY", amountKobo, { kycTier: user.kycTier });
  const feeKobo = feeResult.feeMinor;
  const totalDebit = amountKobo + feeKobo;

  const wallet = await db.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet) return errorJson("Wallet not found", 404);
  if (wallet.status !== "ACTIVE")
    return errorJson("Wallet is frozen", 403, "WALLET_FROZEN");
  if (wallet.balanceKobo < totalDebit)
    return errorJson("Insufficient funds", 400, "INSUFFICIENT_FUNDS");

  // AML check now runs INSIDE the hold transaction (passed via the `aml`
  // field below) — atomic with the debit, closes the F6 race window.

  // Pre-generate the provider-facing reference so the adapter can use it as an
  // idempotency key (audit-providers found that "PENDING" gave the provider no
  // usable dedup key on retry).
  const providerReference = generateReference("BS");

  try {
    const result = await executeProviderDebit({
      userId: user.id,
      walletId: wallet.id,
      type: "BILL_UTILITY",
      refType: "BILL",
      amountKobo: totalDebit,
      description: `${input.productName} — ${input.customer}`,
      counterpartyName: input.productName,
      counterpartyAccount: input.customer,
      provider: "billswift",
      metadata: {
        category: input.category,
        customer: input.customer,
        product: input.productName,
        productCode: input.productCode,
        providerReference,
        feeKobo,
        feeType: feeResult.type,
      },
      aml: { userId: user.id, kycTier: user.kycTier },
      sideModel: "billPayment",
      createSideRow: async (tx, transactionId) => {
        const row = await tx.billPayment.create({
          data: {
            userId: user.id,
            transactionId,
            category: input.category,
            provider: "billswift",
            customer: input.customer,
            customerName: input.customerName,
            product: input.productName,
            amountKobo: totalDebit,
            feeKobo,
            status: "PENDING",
            reference: providerReference,
          },
        });
        return row.id;
      },
      providerCall: async () => {
        const bp = await providers.billPayment();
        const r = await bp.pay({
          productCode: input.productCode,
          customer: input.customer,
          customerName: input.customerName,
          amountMinor: amountKobo,
          currency: "NGN",
          ...(input.meterType ? { meterType: input.meterType } : {}),
          reference: providerReference,
        });
        if (!r.ok || !r.data)
          throw new Error(r.error?.message ?? "Bill payment failed");
        return {
          providerRef: r.data.providerRef,
          extra: { token: r.data.token, receiptNumber: r.data.receiptNumber },
        };
      },
    });

    await audit({
      userId: user.id,
      action: "BILLSWIFT_PAY",
      category: "BILL",
      ip: readIp(req.headers),
      metadata: {
        amountKobo,
        feeKobo,
        totalDebit,
        product: input.productName,
        category: input.category,
        reference: result.reference,
        providerRef: result.providerRef,
      },
    });

    return json({
      data: {
        ok: true,
        reference: result.reference,
        providerRef: result.providerRef,
        newBalanceKobo: result.newBalanceKobo,
      },
    });
  } catch (e: any) {
    return errorJson(
      e.message ?? "Bill payment failed",
      400,
      e.code ?? "PROVIDER_ERROR"
    );
  }
}
