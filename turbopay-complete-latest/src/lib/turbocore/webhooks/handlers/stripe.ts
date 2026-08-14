/**
 * Stripe webhook handler.
 * ----------------------
 * Processes Stripe payment events and credits user wallets.
 *
 * Supported events:
 *   - payment_intent.succeeded → credit wallet
 *   - payment_intent.payment_failed → log failure
 *   - charge.refunded → reverse wallet credit
 *   - checkout.session.completed → credit wallet (checkout flow)
 *   - setup_intent.succeeded → log saved payment method
 *   - setup_intent.setup_failed → log failure
 */
import { db } from "@/lib/db";
import { processFunding } from "@/lib/turbopay/funding";
import { audit } from "@/lib/turbopay/audit";
import { decryptPii } from "@/lib/turbopay/crypto";
import { debitWalletInTx } from "@/lib/turbopay/ledger";
import { generateReference } from "@/lib/turbopay/reference";

interface StripePaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  metadata: Record<string, string>;
  customer: string | null;
  payment_method: string | null;
}

interface StripeCharge {
  id: string;
  amount: number;
  currency: string;
  payment_intent: string;
  refunded: boolean;
  amount_refunded: number;
  metadata: Record<string, string>;
}

/**
 * Process a Stripe webhook event.
 */
export async function handleStripeWebhook(
  event: { id: string; type: string; data: { object: Record<string, unknown> }; created: number },
): Promise<{ processed: boolean; reason?: string }> {
  switch (event.type) {
    case "payment_intent.succeeded":
      return handlePaymentIntentSucceeded(event.data.object as unknown as StripePaymentIntent);

    case "payment_intent.payment_failed":
      return handlePaymentIntentFailed(event.data.object as unknown as StripePaymentIntent);

    case "charge.refunded":
      return handleChargeRefunded(event.data.object as unknown as StripeCharge);

    case "checkout.session.completed":
      return handleCheckoutSessionCompleted(event.data.object as any);

    case "setup_intent.succeeded":
      return handleSetupIntentSucceeded(event.data.object as any);

    case "setup_intent.setup_failed":
      return handleSetupIntentFailed(event.data.object as any);

    default:
      return { processed: false, reason: `Unhandled event type: ${event.type}` };
  }
}

async function handlePaymentIntentSucceeded(
  pi: StripePaymentIntent,
): Promise<{ processed: boolean; reason?: string }> {
  // Skip payment_intents created by checkout sessions —
  // checkout.session.completed handles the wallet credit instead.
  if (pi.metadata?.from_checkout === "true") {
    return { processed: false, reason: "Checkout session payment_intent — handled by checkout.session.completed" };
  }

  const accountNumber = pi.metadata?.accountNumber;
  if (!accountNumber) {
    return { processed: false, reason: "No accountNumber in payment metadata" };
  }

  const result = await processFunding({
    accountNumber,
    amountKobo: pi.amount,
    providerRef: pi.id,
    paymentReference: pi.id,
    description: `Stripe wallet funding — ${pi.currency.toUpperCase()}`,
    provider: "stripe",
  });

  // A duplicate delivery is a SUCCESS — the wallet was already credited.
  if (result.credited || result.reason === "DUPLICATE_WEBHOOK") {
    await audit({
      action: "STRIPE_FUNDING_PROCESSED",
      category: "WALLET",
      severity: "INFO",
      metadata: { paymentIntentId: pi.id, amount: pi.amount, currency: pi.currency, accountNumber, duplicate: result.reason === "DUPLICATE_WEBHOOK" },
    });
    return { processed: true };
  }

  // Deliberate hold (frozen wallet / KYC cap) — acknowledge without retry;
  // the funds are not lost, they are held for review.
  return { processed: false, reason: result.reason };
}

async function handlePaymentIntentFailed(
  pi: StripePaymentIntent,
): Promise<{ processed: boolean; reason?: string }> {
  await audit({
    action: "STRIPE_PAYMENT_FAILED",
    category: "WALLET",
    severity: "WARN",
    metadata: { paymentIntentId: pi.id, amount: pi.amount, currency: pi.currency, status: pi.status },
  });
  return { processed: true, reason: "Payment failure logged" };
}

async function handleChargeRefunded(
  charge: StripeCharge,
): Promise<{ processed: boolean; reason?: string }> {
  const paymentIntentId = charge.payment_intent;
  if (!paymentIntentId) {
    return { processed: false, reason: "No payment_intent on charge" };
  }

  // Idempotency: check if this refund was already processed.
  const existingRefund = await db.transaction.findFirst({
    where: { providerRef: charge.id, type: "REFUND" },
  });
  if (existingRefund) {
    return { processed: false, reason: "Refund already processed" };
  }

  // Find the original funding transaction — try both "stripe" and "monnify"
  // (legacy transactions used hardcoded "monnify" provider).
  const origTx = await db.transaction.findFirst({
    where: { providerRef: paymentIntentId, provider: { in: ["stripe", "monnify"] } },
  });

  if (!origTx) {
    return { processed: false, reason: "Original transaction not found" };
  }

  const refundAmount = charge.amount_refunded || charge.amount;

  // ATOMIC: ledger debit + REFUND transaction record commit in ONE
  // transaction — a crash between the two would leave a debited wallet with
  // no record, and a retried charge.refunded webhook (idempotency check on
  // providerRef=charge.id would MISS the row) would double-debit.
  const { ledgerEntryId } = await db.$transaction(async (tx) => {
    const debit = await debitWalletInTx(
      tx,
      origTx.walletId,
      refundAmount,
      "REVERSAL",
      {
        refId: charge.id,
        userId: origTx.userId,
        description: `Refund for Stripe payment ${paymentIntentId}`,
      },
    );
    await tx.transaction.create({
      data: {
        reference: generateReference("REF"),
        userId: origTx.userId,
        walletId: origTx.walletId,
        type: "REFUND",
        direction: "DEBIT",
        amountKobo: refundAmount,
        feeKobo: 0,
        status: "SUCCESS",
        counterpartyName: "Stripe Refund",
        counterpartyAccount: "",
        counterpartyBank: "Stripe",
        provider: "stripe",
        providerRef: charge.id,
        description: `Refund for Stripe payment ${paymentIntentId}`,
      },
    });
    return debit;
  }, { timeout: 15000 });

  await audit({
    action: "STRIPE_REFUND_PROCESSED",
    category: "WALLET",
    severity: "INFO",
    metadata: { chargeId: charge.id, paymentIntentId, refundAmount, currency: charge.currency, ledgerEntryId },
  });

  return { processed: true };
}

async function handleCheckoutSessionCompleted(
  session: { id: string; metadata?: Record<string, string>; payment_status?: string; amount_total?: number; currency?: string },
): Promise<{ processed: boolean; reason?: string }> {
  if (session.payment_status !== "paid") {
    return { processed: false, reason: `Checkout session not paid: ${session.payment_status}` };
  }

  // Resolve virtual account from the userId in metadata.
  const userId = session.metadata?.userId;
  if (!userId) {
    return { processed: false, reason: "No userId in session metadata" };
  }

  // Try the accountNumber from metadata first, then fall back to looking up the user's virtual account.
  let accountNumber = session.metadata?.accountNumber;
  if (!accountNumber) {
    const va = await db.virtualAccount.findFirst({
      where: { userId, status: "ACTIVE" },
    });
    if (!va) {
      return { processed: false, reason: `No active virtual account for user ${userId}` };
    }
    accountNumber = va.accountNumber;
  }

  const result = await processFunding({
    accountNumber,
    amountKobo: session.amount_total ?? 0,
    providerRef: session.id,
    paymentReference: session.id,
    description: `Stripe Checkout — ${(session.currency ?? "NGN").toUpperCase()}`,
    provider: "stripe",
  });

  // A duplicate delivery is a SUCCESS — the wallet was already credited.
  if (result.credited || result.reason === "DUPLICATE_WEBHOOK") {
    await audit({
      action: "STRIPE_CHECKOUT_PROCESSED",
      category: "WALLET",
      severity: "INFO",
      metadata: { sessionId: session.id, amount: session.amount_total, currency: session.currency, duplicate: result.reason === "DUPLICATE_WEBHOOK" },
    });
    return { processed: true };
  }

  // Deliberate hold (frozen wallet / KYC cap) — acknowledge without retry.
  return { processed: false, reason: result.reason };
}

async function handleSetupIntentSucceeded(
  si: { id: string; customer?: string | null; payment_method?: string | null; metadata?: Record<string, string> },
): Promise<{ processed: boolean; reason?: string }> {
  const userId = si.metadata?.userId;
  await audit({
    action: "STRIPE_PAYMENT_METHOD_SAVED",
    category: "WALLET",
    severity: "INFO",
    metadata: {
      setupIntentId: si.id,
      customerId: si.customer ?? null,
      paymentMethodId: si.payment_method ?? null,
      userId: userId ?? null,
    },
  });
  return { processed: true, reason: "Payment method saved" };
}

async function handleSetupIntentFailed(
  si: { id: string; customer?: string | null; last_setup_error?: { message?: string } | null; metadata?: Record<string, string> },
): Promise<{ processed: boolean; reason?: string }> {
  await audit({
    action: "STRIPE_SETUP_INTENT_FAILED",
    category: "WALLET",
    severity: "WARN",
    metadata: {
      setupIntentId: si.id,
      customerId: si.customer ?? null,
      error: si.last_setup_error?.message ?? "Unknown error",
      userId: si.metadata?.userId ?? null,
    },
  });
  return { processed: true, reason: "Setup intent failure logged" };
}

/**
 * Verify Stripe webhook signature using the secret from ProviderConfig.
 */
export async function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string,
): Promise<Record<string, unknown> | null> {
  const config = await db.providerConfig.findFirst({
    where: { providerName: "stripe", enabled: true },
    select: { credentialsEnc: true },
  });

  if (!config?.credentialsEnc) return null;

  let webhookSecret: string;
  try {
    const creds = JSON.parse(decryptPii(config.credentialsEnc));
    webhookSecret = creds.webhookSecret;
    if (!webhookSecret) return null;
  } catch {
    return null;
  }

  try {
    const crypto = require("crypto");
    const parts = signatureHeader.split(",").reduce(
      (acc: { timestamp: string; signatures: string[] }, part: string) => {
        const [key, value] = part.split("=");
        if (key === "t") acc.timestamp = value;
        if (key === "v1") acc.signatures.push(value);
        return acc;
      },
      { timestamp: "", signatures: [] as string[] },
    );

    const timestamp = parseInt(parts.timestamp, 10);
    if (Math.abs(Date.now() / 1000 - timestamp) > 300) return null;

    const payload = `${parts.timestamp}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(payload)
      .digest("hex");

    const signatureMatch = parts.signatures.some(
      (sig: string) => crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSignature)),
    );

    if (!signatureMatch) return null;
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
}
