/**
 * Payment Link Service
 *
 * Enables users to create shareable payment links that customers can
 * click to complete payments. Supports fixed amounts, custom amounts,
 * expiry, usage limits, and provider-agnostic routing.
 */

import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { generateReference } from "@/lib/turbopay/reference";
import { capabilityRegistry } from "@/lib/turbocore/providers/capabilities";

// ─── Types ───────────────────────────────────────────────────

export interface CreatePaymentLinkInput {
  userId: string;
  title: string;
  description?: string;
  amountNaira?: number; // 0 or undefined = user enters amount
  currency?: string;
  allowCustomAmount?: boolean;
  minAmountNaira?: number;
  maxAmountNaira?: number;
  maxUses?: number;
  expiresInHours?: number;
  metadata?: Record<string, unknown>;
}

export interface PaymentLinkView {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  amountKobo: number;
  currency: string;
  allowCustomAmount: boolean;
  minAmountKobo: number | null;
  maxAmountKobo: number | null;
  maxUses: number | null;
  useCount: number;
  status: string;
  url: string;
  createdAt: Date;
}

// ─── Service ─────────────────────────────────────────────────

class PaymentLinkService {
  /**
   * Create a new payment link.
   */
  async create(input: CreatePaymentLinkInput): Promise<PaymentLinkView> {
    const reference = generateReference("PL");
    const amountKobo = input.amountNaira ? Math.round(input.amountNaira * 100) : 0;
    const minAmountKobo = input.minAmountNaira ? Math.round(input.minAmountNaira * 100) : null;
    const maxAmountKobo = input.maxAmountNaira ? Math.round(input.maxAmountNaira * 100) : null;

    const expiresAt = input.expiresInHours
      ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000)
      : null;

    const link = await db.paymentLink.create({
      data: {
        userId: input.userId,
        reference,
        title: input.title,
        description: input.description ?? null,
        amountKobo,
        currency: input.currency ?? "NGN",
        allowCustomAmount: input.allowCustomAmount ?? false,
        minAmountKobo,
        maxAmountKobo,
        maxUses: input.maxUses ?? null,
        expiresAt,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });

    await audit({
      userId: input.userId,
      action: "PAYMENT_LINK_CREATED",
      category: "WALLET",
      severity: "INFO",
      metadata: { reference, title: input.title, amountKobo },
    });

    return this.toView(link);
  }

  /**
   * Get a payment link by reference (public — no auth required).
   */
  async getByReference(reference: string): Promise<PaymentLinkView | null> {
    const link = await db.paymentLink.findUnique({
      where: { reference },
      include: { _count: { select: { payments: { where: { status: "SUCCESS" } } } } },
    });

    if (!link) return null;

    // Check if expired
    if (link.expiresAt && link.expiresAt < new Date()) {
      await db.paymentLink.update({ where: { id: link.id }, data: { status: "EXPIRED" } });
      return null;
    }

    // Check if max uses reached
    if (link.maxUses && link.useCount >= link.maxUses) {
      return null;
    }

    return this.toView(link);
  }

  /**
   * Get all payment links for a user.
   */
  async getUserLinks(userId: string): Promise<PaymentLinkView[]> {
    const links = await db.paymentLink.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { payments: { where: { status: "SUCCESS" } } } } },
    });
    return links.map((l) => this.toView(l));
  }

  /**
   * Record a payment made via a payment link.
   */
  async recordPayment(
    paymentLinkId: string,
    params: {
      reference: string;
      amountKobo: number;
      feeKobo?: number;
      status: string;
      payerEmail?: string;
      payerName?: string;
      provider?: string;
      providerRef?: string;
    }
  ): Promise<void> {
    await db.paymentLinkPayment.create({
      data: {
        paymentLinkId,
        reference: params.reference,
        amountKobo: params.amountKobo,
        feeKobo: params.feeKobo ?? 0,
        status: params.status,
        payerEmail: params.payerEmail,
        payerName: params.payerName,
        provider: params.provider,
        providerRef: params.providerRef,
      },
    });

    // Increment use count
    await db.paymentLink.update({
      where: { id: paymentLinkId },
      data: { useCount: { increment: 1 } },
    });
  }

  /**
   * Pause/unpause a payment link.
   */
  async toggleStatus(userId: string, linkId: string): Promise<PaymentLinkView> {
    const link = await db.paymentLink.findFirst({ where: { id: linkId, userId } });
    if (!link) throw new Error("Payment link not found");

    const newStatus = link.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    const updated = await db.paymentLink.update({
      where: { id: linkId },
      data: { status: newStatus },
    });

    return this.toView(updated);
  }

  /**
   * Get payment link analytics.
   */
  async getAnalytics(userId: string, linkId: string) {
    const link = await db.paymentLink.findFirst({ where: { id: linkId, userId } });
    if (!link) throw new Error("Payment link not found");

    const payments = await db.paymentLinkPayment.findMany({
      where: { paymentLinkId: linkId },
      orderBy: { createdAt: "desc" },
    });

    const totalAmountKobo = payments
      .filter((p) => p.status === "SUCCESS")
      .reduce((sum, p) => sum + p.amountKobo, 0);

    const totalFeesKobo = payments
      .filter((p) => p.status === "SUCCESS")
      .reduce((sum, p) => sum + p.feeKobo, 0);

    return {
      link: this.toView(link),
      totalPayments: payments.length,
      successfulPayments: payments.filter((p) => p.status === "SUCCESS").length,
      failedPayments: payments.filter((p) => p.status === "FAILED").length,
      totalAmountKobo,
      totalFeesKobo,
      payments: payments.slice(0, 20),
    };
  }

  // ─── Helpers ─────────────────────────────────────────────

  private toView(link: any): PaymentLinkView {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://turbopay.okomba.com";
    return {
      id: link.id,
      reference: link.reference,
      title: link.title,
      description: link.description,
      amountKobo: link.amountKobo,
      currency: link.currency,
      allowCustomAmount: link.allowCustomAmount,
      minAmountKobo: link.minAmountKobo,
      maxAmountKobo: link.maxAmountKobo,
      maxUses: link.maxUses,
      useCount: link.useCount,
      status: link.status,
      url: `${baseUrl}/pay/${link.reference}`,
      createdAt: link.createdAt,
    };
  }
}

export const paymentLinks = new PaymentLinkService();
