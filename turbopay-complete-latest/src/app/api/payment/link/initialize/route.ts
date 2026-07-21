import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { paymentLinks } from "@/lib/turbocore/payment-links";
import { routingEngine } from "@/lib/turbocore/config/routing-engine";
import { adapterFactory } from "@/lib/turbocore/providers/adapter-factory";
import { getCircuitBreaker } from "@/lib/turbocore/providers/circuit-breaker";
import { audit } from "@/lib/turbopay/audit";
import { generateReference } from "@/lib/turbopay/reference";
import { z } from "zod";
import type { IWalletFundingProvider } from "@/lib/turbocore/providers/interfaces";

const schema = z.object({
  reference: z.string().min(1),
  amountNaira: z.number().min(1),
  email: z.string().email(),
  name: z.string().optional(),
  method: z.enum(["card", "bank", "mobile_money"]).optional(),
});

/**
 * POST /api/payment/link/initialize — Initialize a payment for a payment link.
 *
 * Uses the routing engine to select the best provider, calls the provider's
 * API to initialize the payment, and returns the authorization URL for the
 * customer to complete payment on the provider's hosted checkout page.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    // Find the payment link
    const link = await db.paymentLink.findUnique({
      where: { reference: parsed.data.reference, status: "ACTIVE" },
    });
    if (!link) {
      return NextResponse.json({ error: "Payment link not found or inactive" }, { status: 404 });
    }

    // Check expiry and usage limits
    if (link.expiresAt && link.expiresAt < new Date()) {
      return NextResponse.json({ error: "Payment link has expired" }, { status: 410 });
    }
    if (link.maxUses && link.useCount >= link.maxUses) {
      return NextResponse.json({ error: "Payment link has reached its usage limit" }, { status: 410 });
    }

    // Validate amount
    const amountNaira = parsed.data.amountNaira;
    const amountKobo = Math.round(amountNaira * 100);
    if (link.amountKobo > 0 && amountKobo !== link.amountKobo) {
      return NextResponse.json({ error: `Amount must be ${link.amountKobo / 100} ${link.currency}` }, { status: 400 });
    }
    if (link.minAmountKobo && amountKobo < link.minAmountKobo) {
      return NextResponse.json({ error: `Minimum amount is ${link.minAmountKobo / 100} ${link.currency}` }, { status: 400 });
    }
    if (link.maxAmountKobo && amountKobo > link.maxAmountKobo) {
      return NextResponse.json({ error: `Maximum amount is ${link.maxAmountKobo / 100} ${link.currency}` }, { status: 400 });
    }

    // Create a transaction reference
    const txRef = generateReference("TPL");

    // Route to the best provider for collection
    const decision = await routingEngine.decide({
      contract: "walletFunding",
      userId: `link-${link.id}`,
      amountMinor: amountKobo,
      country: "NG",
      currency: (link.currency as any) ?? "NGN",
      correlationId: txRef,
    });

    if (!decision.selectedProviderConfigId) {
      return NextResponse.json(
        { error: "No payment providers available", details: decision.selectionReason },
        { status: 503 },
      );
    }

    // Create the provider adapter
    const provider = await adapterFactory.create(
      "walletFunding",
      decision.selectedProviderConfigId,
    );

    if (!provider || !("initiateFunding" in (provider as any))) {
      return NextResponse.json({ error: "Provider adapter unavailable" }, { status: 503 });
    }

    // Record the payment attempt
    await paymentLinks.recordPayment(link.id, {
      reference: txRef,
      amountKobo,
      status: "PENDING",
      payerEmail: parsed.data.email,
      payerName: parsed.data.name,
      provider: decision.selectedProviderName,
    });

    // Call the provider's API to initialize the payment
    const fwProvider = provider as IWalletFundingProvider;
    const result = await fwProvider.initiateFunding(
      {
        accountNumber: `link-${link.id}`,
        amountMinor: amountKobo,
        currency: (link.currency as any) ?? "NGN",
        reference: txRef,
      },
      {
        product: "turbopay",
        country: "NG",
        correlationId: txRef,
        idempotencyKey: txRef,
      },
    );

    // Record success in circuit breaker
    const breaker = getCircuitBreaker(decision.selectedProviderName);
    try {
      await breaker.execute(() => Promise.resolve());
    } catch { /* ignore */ }

    if (!result.ok) {
      // Record failure in circuit breaker
      try {
        await breaker.execute(() => Promise.reject(new Error(result.error?.message)));
      } catch { /* ignore */ }

      await audit({
        action: "COLLECTION_FAILED",
        category: "WALLET",
        severity: "WARN",
        metadata: {
          linkId: link.id,
          reference: txRef,
          provider: decision.selectedProviderName,
          error: result.error?.message,
          amountKobo,
        },
      });

      return NextResponse.json(
        { error: "Payment initialization failed", details: result.error?.message },
        { status: 502 },
      );
    }

    await audit({
      action: "COLLECTION_INITIATED",
      category: "WALLET",
      severity: "INFO",
      metadata: {
        linkId: link.id,
        reference: txRef,
        providerRef: result.providerRef,
        provider: decision.selectedProviderName,
        amountKobo,
      },
    });

    return NextResponse.json({
      data: {
        reference: txRef,
        amount: amountNaira,
        currency: link.currency,
        provider: decision.selectedProviderName,
        status: "initialized",
        authorizationUrl: result.data?.authorizationUrl ?? null,
      },
    });
  } catch (e: any) {
    console.error("[Payment Link Initialize Error]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
