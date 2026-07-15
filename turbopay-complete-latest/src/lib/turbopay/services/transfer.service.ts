/**
 * Turbopay Service Layer — TransferService.
 * ==========================================
 *
 * Handles BOTH transfer types in one method:
 *
 *   1. INTERNAL (Turbopay → Turbopay): the recipient is another Turbopay user
 *      (phone / email / Turbopay account number). Pure ledger move via
 *      `transferBetweenWallets` — no external provider. Both legs + both
 *      Transaction rows + beneficiary save run inside ONE Prisma tx.
 *
 *   2. EXTERNAL (Turbopay → any Nigerian bank, NIP): the recipient is an
 *      external NUBAN (`accountNumber` + `bankCode`). Goes through TurboCore
 *      `providers.localTransfer()` (Paystack in prod, mock in dev) via the
 *      `executeProviderDebit` hold/confirm/reverse orchestrator. If the
 *      provider call fails, the hold is auto-reversed.
 *
 * Both paths share the same auth / PIN / rate-limit / idempotency / AML gate
 * (the route handles auth + body parsing + Zod; the service handles everything
 * from PIN verification onwards).
 *
 * Extracted from src/app/api/transfer/route.ts.
 */

import { db } from "@/lib/db";
import { resolveTurbopayRecipient } from "@/lib/turbopay/wallet";
import { transferBetweenWallets, LedgerError } from "@/lib/turbopay/ledger";
import { checkDebit } from "@/lib/turbopay/aml";
import { audit } from "@/lib/turbopay/audit";
import { verifyTransactionPin } from "@/lib/turbopay/pin";
import { executeProviderDebit, AmlBlockedError } from "@/lib/turbopay/payments";
import { providers } from "@/lib/turbocore/providers/registry";
import { fees } from "@/lib/turbocore/fees";
import { notify } from "@/lib/turbocore/notifications";
import { nairaToKobo } from "@/lib/turbopay/money";
import { generateReference } from "@/lib/turbopay/reference";
import { getIdempotentResponse, startIdempotency, completeIdempotency } from "@/lib/turbopay/idempotency";
import { ServiceError } from "./types";
import type { SendTransferInput, SendTransferResult } from "./types";

class TransferService {
  async send(input: SendTransferInput): Promise<SendTransferResult> {
    const {
      user,
      recipient,
      accountNumber,
      bankCode,
      bankName,
      recipientName,
      amountNaira,
      note,
      saveBeneficiary,
      pin,
      ip,
      idemKey,
    } = input;
    const amountKobo = nairaToKobo(amountNaira);

    // 1. Transaction PIN — required for every debit.
    const pinCheck = await verifyTransactionPin(user, pin);
    if (!pinCheck.ok) {
      throw new ServiceError(pinCheck.code ?? "PIN_ERROR", pinCheck.error ?? "PIN verification failed", 400);
    }

    // 2. Idempotency — use the dedicated IdempotencyRecord table.
    if (idemKey) {
      const cached = await getIdempotentResponse<SendTransferResult>(idemKey);
      if (cached.hit) return cached.body;
      const started = await startIdempotency(idemKey, "/api/transfer", user.id);
      if (!started.started) {
        throw new ServiceError(
          "IDEMPOTENCY_INFLIGHT",
          "A transfer with this idempotency key is already processing",
          409,
        );
      }
    }

    const senderWallet = await db.wallet.findUnique({ where: { userId: user.id } });
    if (!senderWallet) throw new ServiceError("WALLET_NOT_FOUND", "Wallet not found", 404);
    if (senderWallet.status !== "ACTIVE") throw new ServiceError("WALLET_FROZEN", "Wallet is frozen", 403);

    // Compute fee for external transfers (internal Turbopay transfers are free).
    const isExternal = !!accountNumber && !!bankCode;
    const feeResult = isExternal
      ? await fees.calculate("turbopay", "TRANSFER", amountKobo, { kycTier: user.kycTier })
      : { feeMinor: 0 };
    const feeKobo = feeResult.feeMinor;
    const totalDebit = amountKobo + feeKobo;

    if (senderWallet.balanceKobo < totalDebit) {
      throw new ServiceError("INSUFFICIENT_FUNDS", "Insufficient funds", 400);
    }

    // 3. AML / limits. For the EXTERNAL path, the AML check runs INSIDE the
    //    hold transaction via `executeProviderDebit({ aml: ... })` (atomic
    //    with the debit — closes the F6 race window). For the INTERNAL path,
    //    the AML check runs here (the internal path uses
    //    `transferBetweenWallets`, not `executeProviderDebit`, so the in-tx
    //    hook can't be applied).
    let amlFlags: { rule: string; severity: string; description: string }[] = [];
    if (!isExternal) {
      const aml = await checkDebit(user.id, senderWallet.id, amountKobo, user.kycTier);
      if (!aml.allowed) {
        await audit({
          userId: user.id,
          action: "TRANSFER_BLOCKED_AML",
          category: "AML",
          severity: "WARN",
          ip,
          metadata: { amountKobo, recipient, accountNumber, bankCode, flags: aml.flags, reason: aml.reason },
        });
        throw new ServiceError("AML_BLOCKED", aml.reason ?? "Transaction blocked by risk monitoring", 400);
      }
      amlFlags = aml.flags;
    }

    if (isExternal) {
      return this.executeExternalTransfer({
        user,
        senderWallet,
        amountKobo,
        feeKobo,
        accountNumber: accountNumber!,
        bankCode: bankCode!,
        bankName,
        recipientName,
        note,
        saveBeneficiary,
        kycTier: user.kycTier,
        idemKey,
        ip,
      });
    }

    return this.executeInternalTransfer({
      user,
      senderWallet,
      amountKobo,
      recipient: recipient!.trim(),
      note,
      saveBeneficiary,
      amlFlags,
      idemKey,
      ip,
    });
  }

  // ─── Internal transfer (Turbopay → Turbopay) ──────────────────────────

  private async executeInternalTransfer(args: {
    user: { id: string; fullName: string; phone: string | null };
    senderWallet: { id: string };
    amountKobo: number;
    recipient: string;
    note?: string;
    saveBeneficiary?: boolean;
    amlFlags: { rule: string; severity: string; description: string }[];
    idemKey: string | null;
    ip?: string;
  }): Promise<SendTransferResult> {
    const { user, senderWallet, amountKobo, recipient, note, saveBeneficiary, amlFlags, idemKey, ip } = args;

    const rec = await resolveTurbopayRecipient(recipient);
    if (!rec) {
      throw new ServiceError(
        "RECIPIENT_NOT_FOUND",
        "Recipient not found on Turbopay. Check the phone, email or account number.",
        404,
      );
    }
    if (rec.user.id === user.id) {
      throw new ServiceError("SELF_TRANSFER", "You cannot transfer to yourself", 400);
    }
    if (!rec.wallet || rec.wallet.status !== "ACTIVE") {
      throw new ServiceError("RECIPIENT_NOT_ACTIVE", "Recipient account is not active and cannot receive funds.", 400);
    }
    if (rec.user.status !== "ACTIVE") {
      throw new ServiceError("RECIPIENT_NOT_ACTIVE", "Recipient account is not active and cannot receive funds.", 400);
    }
    const recipientWallet = rec.wallet;

    const noteText = note?.trim() || `Transfer to ${rec.user.fullName}`;

    // ATOMIC: the double-entry ledger post AND both transaction records AND the
    // optional beneficiary save all run inside ONE Prisma transaction.
    let outRef: string;
    let fromBalanceAfter: number;
    try {
      const result = await db.$transaction(
        async (tx) => {
          const transfer = await transferBetweenWallets(
            senderWallet.id,
            recipientWallet.id,
            amountKobo,
            "TRANSFER",
            { description: noteText },
            tx,
          );
          const outTx = await tx.transaction.create({
            data: {
              reference: generateReference("TP"),
              userId: user.id,
              walletId: senderWallet.id,
              type: "TRANSFER_OUT",
              direction: "DEBIT",
              amountKobo,
              description: noteText,
              counterpartyName: rec.user.fullName,
              counterpartyAccount: rec.vaccount?.accountNumber ?? rec.user.phone ?? "unknown",
              counterpartyBank: rec.vaccount?.bankName ?? "Turbopay MFB",
              provider: "turbopay",
              status: "SUCCESS",
              metadata: JSON.stringify({
                note,
                ledgerEntryId: transfer.debitEntryId,
                idemKey: idemKey ?? null,
              }),
            },
          });
          await tx.transaction.create({
            data: {
              reference: generateReference("TP"),
              userId: rec.user.id,
              walletId: recipientWallet.id,
              type: "TRANSFER_IN",
              direction: "CREDIT",
              amountKobo,
              description: `Transfer from ${user.fullName}`,
              counterpartyName: user.fullName,
              counterpartyAccount: rec.vaccount?.accountNumber ?? user.phone ?? "unknown",
              counterpartyBank: "Turbopay MFB",
              provider: "turbopay",
              status: "SUCCESS",
              metadata: JSON.stringify({ note, ledgerEntryId: transfer.creditEntryId }),
            },
          });
          if (saveBeneficiary) {
            const exists = await tx.beneficiary.findFirst({
              where: {
                userId: user.id,
                accountNumber: rec.vaccount?.accountNumber ?? rec.user.phone ?? "unknown",
              },
            });
            if (!exists) {
              await tx.beneficiary.create({
                data: {
                  userId: user.id,
                  name: rec.user.fullName,
                  accountNumber: rec.vaccount?.accountNumber ?? rec.user.phone ?? "unknown",
                  bankName: rec.vaccount?.bankName ?? "Turbopay MFB",
                  bankCode: rec.vaccount?.bankCode ?? "999001",
                  type: "TURBOPAY",
                },
              });
            }
          }
          return { outRef: outTx.reference, fromBalanceAfter: transfer.fromBalanceAfter };
        },
        { timeout: 15000 },
      );
      outRef = result.outRef;
      fromBalanceAfter = result.fromBalanceAfter;
    } catch (e: any) {
      if (e instanceof LedgerError) {
        const status = e.code === "INSUFFICIENT_FUNDS" ? 400 : e.code === "WALLET_FROZEN" ? 403 : 400;
        throw new ServiceError(e.code, e.message, status);
      }
      throw e;
    }

    await audit({
      userId: user.id,
      action: "TRANSFER_SENT",
      category: "TRANSFER",
      ip,
      metadata: { amountKobo, to: rec.user.id, reference: outRef, flags: amlFlags, external: false },
    });

    // Fire-and-forget in-app notifications.
    const amountNairaStr = `₦${(amountKobo / 100).toLocaleString()}`;
    notify
      .sendInApp({
        userId: user.id,
        type: "TRANSACTION",
        title: "Transfer Sent",
        message: `To ${rec.user.fullName} · ${amountNairaStr} · Ref: ${outRef}`,
        actionUrl: "/history",
        actionLabel: "View receipt",
      })
      .catch(() => null);
    notify
      .sendInApp({
        userId: rec.user.id,
        type: "TRANSACTION",
        title: "Transfer Received",
        message: `From ${user.fullName} · ${amountNairaStr} · Ref: ${outRef}`,
        actionUrl: "/history",
        actionLabel: "View receipt",
      })
      .catch(() => null);

    const responseBody: SendTransferResult = {
      ok: true,
      reference: outRef,
      amountKobo,
      feeKobo: 0,
      recipientName: rec.user.fullName,
      newBalanceKobo: fromBalanceAfter,
    };
    if (idemKey) await completeIdempotency(idemKey, 200, responseBody);
    return responseBody;
  }

  // ─── External transfer (Turbopay → Nigerian bank, via TurboCore) ──────

  private async executeExternalTransfer(args: {
    user: { id: string; fullName: string; phone: string | null };
    senderWallet: { id: string };
    amountKobo: number;
    feeKobo: number;
    accountNumber: string;
    bankCode: string;
    bankName?: string;
    recipientName?: string;
    note?: string;
    saveBeneficiary?: boolean;
    kycTier: 1 | 2 | 3;
    idemKey: string | null;
    ip?: string;
  }): Promise<SendTransferResult> {
    const {
      user,
      senderWallet,
      amountKobo,
      feeKobo,
      accountNumber,
      bankCode,
      bankName,
      recipientName,
      note,
      saveBeneficiary,
      kycTier,
      idemKey,
      ip,
    } = args;

    const lt = await providers.localTransfer({ product: "turbopay", idempotencyKey: idemKey ?? undefined });
    const providerName = lt.name.replace("mock-", "").replace("production-", "");

    const senderVaccount = await db.virtualAccount.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      select: { accountNumber: true },
    });
    const fromAccount = senderVaccount?.accountNumber ?? user.phone ?? "0000000000";

    const counterpartyName = recipientName?.trim() || `Bank transfer · ${accountNumber}`;
    const noteText = note?.trim() || `Bank transfer to ${counterpartyName}`;
    const providerReference = generateReference("NIP");

    let result;
    let amlFlags: { rule: string; severity: string; description: string }[] = [];
    try {
      result = await executeProviderDebit({
        userId: user.id,
        walletId: senderWallet.id,
        type: "TRANSFER_OUT",
        refType: "TRANSFER",
        amountKobo: amountKobo + feeKobo,
        description: noteText,
        counterpartyName,
        counterpartyAccount: accountNumber,
        counterpartyBank: bankName ?? bankCode,
        provider: providerName,
        metadata: {
          external: true,
          bankCode,
          accountNumber,
          recipientName: counterpartyName,
          providerReference,
          idemKey: idemKey ?? null,
          feeKobo,
        },
        aml: { userId: user.id, kycTier },
        providerCall: async () => {
          const r = await lt.transfer(
            {
              fromAccount,
              toAccount: accountNumber,
              toBankCode: bankCode,
              amountMinor: amountKobo,
              currency: "NGN",
              reference: providerReference,
              narration: noteText,
            },
            { product: "turbopay", idempotencyKey: idemKey ?? providerReference },
          );
          if (!r.ok || !r.data) {
            throw new Error(r.error?.message ?? "Transfer failed at the provider");
          }
          if (r.data.status === "FAILED") {
            throw new Error("Provider rejected the transfer");
          }
          return {
            providerRef: r.data.providerRef,
            extra: { paystackStatus: r.data.status, external: true, bankCode, accountNumber },
          };
        },
      });
    } catch (e: any) {
      if (e instanceof AmlBlockedError) {
        amlFlags = e?.flags ?? [];
        await audit({
          userId: user.id,
          action: "TRANSFER_BLOCKED_AML",
          category: "AML",
          severity: "WARN",
          ip,
          metadata: { amountKobo, accountNumber, bankCode, flags: amlFlags, reason: e?.message },
        });
        throw new ServiceError("AML_BLOCKED", e?.message ?? "Transaction blocked by risk monitoring", 400);
      }
      throw new ServiceError(e?.code ?? "PROVIDER_ERROR", e?.message ?? "External transfer failed", 400);
    }

    // Save the external beneficiary (non-critical — swallow errors).
    if (saveBeneficiary) {
      try {
        const exists = await db.beneficiary.findFirst({
          where: { userId: user.id, accountNumber, bankCode },
        });
        if (!exists) {
          await db.beneficiary.create({
            data: {
              userId: user.id,
              name: counterpartyName,
              accountNumber,
              bankName: bankName ?? bankCode,
              bankCode,
              type: "EXTERNAL",
            },
          });
        }
      } catch {
        // best-effort
      }
    }

    await audit({
      userId: user.id,
      action: "TRANSFER_SENT",
      category: "TRANSFER",
      ip,
      metadata: {
        amountKobo,
        external: true,
        accountNumber,
        bankCode,
        bankName,
        reference: result.reference,
        providerRef: result.providerRef,
        provider: providerName,
        flags: amlFlags,
      },
    });

    notify
      .sendInApp({
        userId: user.id,
        type: "TRANSACTION",
        title: "Bank Transfer",
        message: `${bankName ?? bankCode} · ${accountNumber} · ₦${(amountKobo / 100).toLocaleString()} · Ref: ${result.reference}`,
        actionUrl: "/history",
        actionLabel: "View receipt",
      })
      .catch(() => null);

    const responseBody: SendTransferResult = {
      ok: true,
      reference: result.reference,
      amountKobo,
      feeKobo,
      recipientName: counterpartyName,
      newBalanceKobo: result.newBalanceKobo,
      external: true,
      providerRef: result.providerRef,
    };
    if (idemKey) await completeIdempotency(idemKey, 200, responseBody);
    return responseBody;
  }
}

export const transferService = new TransferService();
