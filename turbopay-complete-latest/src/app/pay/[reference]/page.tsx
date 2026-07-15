import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PaymentLinkClient } from "./client";

interface Props {
  params: Promise<{ reference: string }>;
}

/**
 * Public payment link landing page.
 * No authentication required — this is what customers see when they click a payment link.
 */
export default async function PaymentLinkPage({ params }: Props) {
  const { reference } = await params;

  const link = await db.paymentLink.findUnique({
    where: { reference, status: "ACTIVE" },
    select: {
      id: true,
      reference: true,
      title: true,
      description: true,
      amountKobo: true,
      currency: true,
      allowCustomAmount: true,
      minAmountKobo: true,
      maxAmountKobo: true,
      maxUses: true,
      useCount: true,
      expiresAt: true,
      user: { select: { fullName: true } },
    },
  });

  if (!link) notFound();

  // Check expiry
  if (link.expiresAt && link.expiresAt < new Date()) notFound();

  // Check max uses
  if (link.maxUses && link.useCount >= link.maxUses) notFound();

  return (
    <PaymentLinkClient
      reference={link.reference}
      title={link.title}
      description={link.description}
      amountKobo={link.amountKobo}
      currency={link.currency}
      allowCustomAmount={link.allowCustomAmount}
      minAmountKobo={link.minAmountKobo}
      maxAmountKobo={link.maxAmountKobo}
      merchantName={link.user.fullName}
    />
  );
}
