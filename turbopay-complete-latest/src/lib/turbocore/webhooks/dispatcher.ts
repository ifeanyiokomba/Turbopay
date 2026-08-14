/**
 * Webhook event dispatcher — maps normalised domain events to their
 * business-layer handlers. Imported by every webhook route to ensure the
 * dispatcher is registered before any event is processed.
 *
 * This replaces the prior monkey-patching pattern where handlers had
 * side-effects baked into their normalize() function. Now normalize() is a
 * pure function, and the dispatcher handles business logic after the
 * registry marks the event PROCESSED.
 *
 * Each event type maps to a business action:
 *   WALLET_FUNDED           → processFunding (credit wallet via ledger)
 *   INTL_TRANSFER_RECEIVED  → settleIntlReceiving (FX → credit → notify)
 *   TRANSFER_COMPLETED      → mark Transaction SUCCESS + notify user
 *   TRANSFER_FAILED         → reverse ledger entry + refund wallet + notify
 *   CARD_FUNDING_SUCCESS    → credit wallet from card charge
 *   BILL_PAYMENT_SUCCESS    → mark BillPayment SUCCESS + deliver token
 *   BILL_PAYMENT_FAILED     → reverse + refund + notify
 *   CARD_AUTHORIZATION      → approve/decline based on balance + controls
 *   CARD_TRANSACTION_POSTED → create VirtualCardTransaction (SPEND)
 *   KYC_VERIFIED            → upgrade user's KYC tier
 *   KYC_FAILED              → notify user + audit
 *   SMS_DELIVERED/FAILED    → update NotificationLog status
 *   EMAIL_DELIVERED/FAILED  → update NotificationLog status
 */

import { webhookRegistry } from "@/lib/turbocore/webhooks/registry";
import { processFunding } from "@/lib/turbopay/funding";
import { settleIntlReceiving } from "@/lib/turbocore/international/settlement";
import { providers } from "@/lib/turbocore/providers/registry";
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { reverseEntry } from "@/lib/turbopay/ledger";
import { notify } from "@/lib/turbocore/notifications";

let registered = false;

export function ensureDispatcherRegistered() {
  if (registered) return;
  registered = true;

  webhookRegistry.setDispatcher(async (events, provider) => {
    for (const e of events) {
      try {
        await dispatchEvent(e, provider);
      } catch (err: any) {
        // Log but don't throw — the event is already marked PROCESSED.
        // The audit trail captures the dispatch failure for replay.
        await audit({
          action: "WEBHOOK_DISPATCH_ERROR",
          category: "WEBHOOK",
          severity: "ERROR",
          metadata: { provider, eventType: e.type, error: err?.message },
        });
      }
    }
  });
}

async function dispatchEvent(e: { type: string; data: Record<string, unknown> }, provider: string) {
  switch (e.type) {
    // ─── Wallet funding (Monnify) ──────────────────────────
    case "WALLET_FUNDED": {
      const d = e.data as { accountNumber: string; amountMinor: number; providerRef: string; paymentReference: string };
      await processFunding({
        accountNumber: d.accountNumber,
        amountKobo: d.amountMinor,
        providerRef: d.providerRef,
        paymentReference: d.paymentReference,
        description: "Wallet funding via webhook",
      });
      break;
    }

    // ─── International transfer received (Wise) ────────────
    case "INTL_TRANSFER_RECEIVED": {
      const d = e.data as { providerRef: string; raw: unknown };
      const receiver = await providers.internationalReceiving();
      const result = await receiver.parseWebhook(d.raw, {});
      if (result.ok && result.data) {
        await settleIntlReceiving(result.data);
      }
      break;
    }

    // ─── Outbound transfer completed (Paystack/Flutterwave/Wise) ──
    case "TRANSFER_COMPLETED": {
      const d = e.data as { providerRef: string; provider: string; status: string };
      const tx = await db.transaction.findFirst({
        where: { providerRef: d.providerRef, provider: d.provider },
      });
      if (tx && tx.status !== "SUCCESS") {
        await db.transaction.update({
          where: { id: tx.id },
          data: { status: "SUCCESS" },
        });
        await notify.sendInApp({
          userId: tx.userId,
          type: "TRANSACTION",
          title: "Transfer Successful",
          message: `Your transfer of ₦${(tx.amountKobo / 100).toLocaleString()} has been completed.`,
          actionUrl: "/history",
          actionLabel: "View transaction",
        }).catch(() => null);
      }
      break;
    }

    // ─── Outbound transfer failed → reverse + refund ───────
    case "TRANSFER_FAILED": {
      const d = e.data as { providerRef: string; provider: string; reason: string };
      const tx = await db.transaction.findFirst({
        where: { providerRef: d.providerRef, provider: d.provider },
        include: { wallet: true },
      });
      if (tx && tx.status === "PENDING") {
        const meta = tx.metadata ? JSON.parse(tx.metadata) : {};
        // ATOMIC: ledger reversal + FAILED status commit in ONE transaction —
        // a crash between the two would leave a refunded wallet with a
        // PENDING row. reverseEntry is idempotent (a REVERSAL leg is created
        // at most once per original entry), so a replayed failure webhook
        // cannot double-refund.
        if (meta.ledgerEntryId) {
          await db.$transaction(async (ptx) => {
            await reverseEntry(
              meta.ledgerEntryId,
              { description: `Reversal — transfer failed: ${d.reason}`, refId: `REVERSAL-${tx.id}` },
              ptx
            );
            await ptx.transaction.update({
              where: { id: tx.id },
              data: { status: "FAILED" },
            });
          }, { timeout: 15000 });
        } else {
          await db.transaction.update({
            where: { id: tx.id },
            data: { status: "FAILED" },
          });
        }
        await notify.sendInApp({
          userId: tx.userId,
          type: "TRANSACTION",
          title: "Transfer Failed",
          message: `Your transfer of ₦${(tx.amountKobo / 100).toLocaleString()} failed. The amount has been refunded to your wallet. Reason: ${d.reason}`,
          priority: "HIGH",
          actionUrl: "/history",
          actionLabel: "View transaction",
        }).catch(() => null);
      }
      break;
    }

    // ─── Card funding success (Paystack/Flutterwave charge) ──
    case "CARD_FUNDING_SUCCESS": {
      const d = e.data as { providerRef: string; provider: string; amountMinor: number; customerEmail?: string };
      // Find the user by email, then credit their wallet.
      if (d.customerEmail) {
        const user = await db.user.findUnique({
          where: { email: d.customerEmail },
          select: { id: true },
        });
        if (user) {
          const wallet = await db.wallet.findUnique({ where: { userId: user.id } });
          if (wallet) {
            // ATOMIC: ledger credit + transaction record commit in ONE
            // transaction — a crash between the two would leave a credited
            // wallet with no transaction history.
            const { creditWalletInTx } = await import("@/lib/turbopay/ledger");
            await db.$transaction(async (tx) => {
              await creditWalletInTx(tx, wallet.id, d.amountMinor, "FUNDING", {
                refId: d.providerRef,
                description: `Card funding via ${d.provider}`,
              });
              await tx.transaction.create({
                data: {
                  reference: `TP-WEBHOOK-${d.providerRef.slice(-12)}`,
                  userId: user.id,
                  walletId: wallet.id,
                  type: "FUNDING",
                  direction: "CREDIT",
                  amountKobo: d.amountMinor,
                  status: "SUCCESS",
                  provider: d.provider,
                  providerRef: d.providerRef,
                  description: `Card funding via ${d.provider}`,
                },
              });
            }, { timeout: 15000 });
            await notify.sendInApp({
              userId: user.id,
              type: "TRANSACTION",
              title: "Wallet Funded",
              message: `₦${(d.amountMinor / 100).toLocaleString()} added to your wallet via card.`,
              actionUrl: "/wallet",
              actionLabel: "View wallet",
            }).catch(() => null);
          }
        }
      }
      break;
    }

    // ─── Bill payment success (Baxi) ────────────────────────
    case "BILL_PAYMENT_SUCCESS": {
      const d = e.data as { providerRef: string; provider: string; token?: string; receiptNumber?: string };
      const bill = await db.billPayment.findFirst({
        where: { reference: d.providerRef },
      });
      if (bill && bill.status !== "SUCCESS") {
        await db.billPayment.update({
          where: { id: bill.id },
          data: { status: "SUCCESS" },
        });
        if (bill.transactionId) {
          await db.transaction.update({
            where: { id: bill.transactionId },
            data: { status: "SUCCESS" },
          });
        }
        await notify.sendInApp({
          userId: bill.userId,
          type: "TRANSACTION",
          title: "Bill Payment Successful",
          message: d.token
            ? `Your bill payment was successful. Token: ${d.token}`
            : `Your bill payment was successful. Receipt: ${d.receiptNumber ?? "N/A"}`,
          actionUrl: "/history",
          actionLabel: "View transaction",
        }).catch(() => null);
      }
      break;
    }

    // ─── Bill payment failed → refund ───────────────────────
    case "BILL_PAYMENT_FAILED": {
      const d = e.data as { providerRef: string; provider: string; reason: string };
      const bill = await db.billPayment.findFirst({
        where: { reference: d.providerRef },
      });
      if (bill && bill.status === "PENDING") {
        // ATOMIC: ledger reversal + Transaction status + BillPayment status
        // commit in ONE transaction — a crash mid-way would leave a refunded
        // wallet with a PENDING bill row. reverseEntry is idempotent, so a
        // replayed failure webhook cannot double-refund.
        await db.$transaction(async (ptx) => {
          if (bill.transactionId) {
            const tx = await ptx.transaction.findUnique({
              where: { id: bill.transactionId },
              select: { id: true, metadata: true, amountKobo: true },
            });
            if (tx) {
              const meta = tx.metadata ? JSON.parse(tx.metadata) : {};
              if (meta.ledgerEntryId) {
                await reverseEntry(
                  meta.ledgerEntryId,
                  { description: `Reversal — bill payment failed: ${d.reason}`, refId: `REVERSAL-${tx.id}` },
                  ptx
                );
              }
              await ptx.transaction.update({
                where: { id: tx.id },
                data: { status: "FAILED" },
              });
            }
          }
          await ptx.billPayment.update({
            where: { id: bill.id },
            data: { status: "FAILED" },
          });
        }, { timeout: 15000 });
        await notify.sendInApp({
          userId: bill.userId,
          type: "TRANSACTION",
          title: "Bill Payment Failed",
          message: `Your bill payment failed. ₦${(bill.amountKobo / 100).toLocaleString()} has been refunded. Reason: ${d.reason}`,
          priority: "HIGH",
          actionUrl: "/history",
          actionLabel: "View transaction",
        }).catch(() => null);
      }
      break;
    }

    // ─── Card authorization (Stripe Issuing) ───────────────
    case "CARD_AUTHORIZATION": {
      // For the in-house Turbopay card issuer, authorizations are handled
      // synchronously at purchase time. This case is for future Stripe Issuing
      // integration — approve/decline based on card balance + controls.
      await audit({
        action: "CARD_AUTHORIZATION_RECEIVED",
        category: "WALLET",
        severity: "INFO",
        metadata: e.data,
      });
      break;
    }

    // ─── Card transaction posted (Stripe Issuing) ──────────
    case "CARD_TRANSACTION_POSTED": {
      const d = e.data as { providerRef: string; cardId: string; amountMinor: number; currency: string; merchant: string; type: string };
      const card = await db.virtualCard.findFirst({
        where: { providerCardId: d.cardId },
      });
      if (!card) break;

      // Dedup: skip if this providerRef was already processed
      const existing = await db.virtualCardTransaction.findFirst({
        where: { providerRef: d.providerRef },
      });
      if (existing) break;

      // Atomic debit + ledger entry in a single transaction
      await db.$transaction(async (tx) => {
        const updated = await tx.virtualCard.updateMany({
          where: { id: card.id, balanceKobo: { gte: d.amountMinor } },
          data: { balanceKobo: { decrement: d.amountMinor } },
        });
        if (updated.count === 0) return; // insufficient balance — skip
        await tx.virtualCardTransaction.create({
          data: {
            cardId: card.id,
            type: "SPEND",
            amountKobo: d.amountMinor,
            currency: d.currency,
            status: "SUCCESS",
            merchant: d.merchant,
            providerRef: d.providerRef,
          },
        });
      });
      break;
    }

    // ─── KYC verified (Dojah) ──────────────────────────────
    case "KYC_VERIFIED": {
      const d = e.data as { providerRef: string; type: string; firstName: string; lastName: string; phoneMatch?: boolean };
      // Find the pending KYC verification by provider reference.
      // KycVerification doesn't have a `reference` field, so we look it up
      // by the providerRef stored in the payload JSON.
      const kyc = await db.kycVerification.findFirst({
        where: { status: "PENDING", payload: { contains: d.providerRef } },
        include: { user: true },
      });
      if (kyc && kyc.status === "PENDING") {
        const newTier = d.type === "BVN" ? 3 : 2; // BVN → Tier 3, NIN → Tier 2
        await db.kycVerification.update({
          where: { id: kyc.id },
          data: { status: "VERIFIED" },
        });
        await db.user.update({
          where: { id: kyc.userId },
          data: { kycTier: newTier },
        });
        await notify.sendInApp({
          userId: kyc.userId,
          type: "KYC",
          title: "KYC Verified",
          message: `Your identity has been verified. You are now Tier ${newTier} — your transaction limits have been increased.`,
          priority: "HIGH",
          actionUrl: "/kyc",
          actionLabel: "View KYC",
        }).catch(() => null);
      }
      break;
    }

    // ─── KYC failed (Dojah) ────────────────────────────────
    case "KYC_FAILED": {
      const d = e.data as { providerRef: string; reason: string };
      const kyc = await db.kycVerification.findFirst({
        where: { status: "PENDING", payload: { contains: d.providerRef } },
      });
      if (kyc && kyc.status === "PENDING") {
        await db.kycVerification.update({
          where: { id: kyc.id },
          data: { status: "REJECTED" },
        });
        await notify.sendInApp({
          userId: kyc.userId,
          type: "KYC",
          title: "KYC Verification Failed",
          message: `Your KYC verification could not be completed. Reason: ${d.reason}. Please try again or contact support.`,
          priority: "HIGH",
          actionUrl: "/kyc",
          actionLabel: "Retry KYC",
        }).catch(() => null);
      }
      break;
    }

    // ─── SMS delivery (Termii) ─────────────────────────────
    case "SMS_DELIVERED":
    case "SMS_FAILED": {
      const d = e.data as { providerRef: string; status: string; reason?: string };
      await db.notificationLog.updateMany({
        where: { messageId: d.providerRef },
        data: { status: d.status === "DELIVERED" ? "DELIVERED" : "FAILED", errorMsg: d.reason },
      }).catch(() => null);
      break;
    }

    // ─── Email delivery (Resend) ───────────────────────────
    case "EMAIL_DELIVERED":
    case "EMAIL_FAILED":
    case "EMAIL_COMPLAINED": {
      const d = e.data as { providerRef: string; status: string; reason?: string };
      await db.notificationLog.updateMany({
        where: { messageId: d.providerRef },
        data: { status: d.status === "DELIVERED" ? "DELIVERED" : "FAILED", errorMsg: d.reason },
      }).catch(() => null);
      break;
    }

    // ─── Ignored events (no action needed) ─────────────────
    default:
      // PAYSTACK_EVENT_IGNORED, FLW_EVENT_IGNORED, etc.
      break;
  }
}

// Register immediately on module load.
ensureDispatcherRegistered();
