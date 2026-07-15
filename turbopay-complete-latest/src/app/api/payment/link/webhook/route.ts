import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { paymentLinks } from "@/lib/turbocore/payment-links";
import { audit } from "@/lib/turbopay/audit";

/**
 * POST /api/payment/link/webhook — Handle payment link webhook from providers.
 *
 * When a customer completes a payment via a payment link, the provider
 * sends a webhook. This endpoint records the payment against the link.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { reference, status, amount, fee, provider, providerRef, payerEmail, payerName } = body;

    if (!reference || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Find the payment link payment record
    const payment = await db.paymentLinkPayment.findUnique({
      where: { reference },
      include: { paymentLink: true },
    });

    if (!payment) {
      // Not a payment link transaction — ignore
      return NextResponse.json({ received: true });
    }

    // Update payment status
    await db.paymentLinkPayment.update({
      where: { id: payment.id },
      data: {
        status: status === "success" ? "SUCCESS" : "FAILED",
        feeKobo: fee ?? 0,
        provider: provider ?? payment.provider,
        providerRef: providerRef ?? payment.providerRef,
      },
    });

    // Increment use count on successful payment
    if (status === "success") {
      await db.paymentLink.update({
        where: { id: payment.paymentLinkId },
        data: { useCount: { increment: 1 } },
      });
    }

    await audit({
      userId: payment.paymentLink.userId,
      action: "PAYMENT_LINK_PAYMENT_RECEIVED",
      category: "WALLET",
      severity: status === "success" ? "INFO" : "WARN",
      metadata: { reference, status, amount, provider, paymentLinkId: payment.paymentLinkId },
    });

    return NextResponse.json({ received: true });
  } catch (e: any) {
    console.error("[Payment Link Webhook Error]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
