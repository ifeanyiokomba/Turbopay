import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { creditWallet, getLedgerBalance } from "@/lib/turbopay/ledger";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { nairaToKobo } from "@/lib/turbopay/money";
import { transferService, ServiceError } from "@/lib/turbopay/services";
import type { SessionUser } from "@/lib/turbopay/types";

/**
 * TRANSFER E2E — the REAL application flow through TransferService:
 *
 *   auth (PIN verify) → recipient resolution / validation → AML check →
 *   hold (wallet debit + PENDING transaction, atomic) → provider call
 *   (mock local-transfer adapter — no real money) → confirm/reverse →
 *   final status → wallet/ledger effect.
 *
 * Uses the app's actual service layer + real Postgres. The provider is the
 * mock adapter (deterministic, network-free) — no real financial transfer
 * is performed. Both the INTERNAL (Turbopay → Turbopay) and EXTERNAL
 * (Turbopay → bank via mock NIP) paths are exercised.
 */

let sender: SessionUser;
let senderUserId: string;
let senderWalletId: string;

let recipientUser: SessionUser;
let recipientUserId: string;
let recipientWalletId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();

  // Sender — verified Tier 2 with a PIN.
  const s = await db.user.create({
    data: {
      fullName: "E2E Sender",
      email: `e2e-sender-${suffix}@turbopay.test`,
      phone: `+234700111${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("password123"),
      transactionPinHash: hashPassword("1234"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  senderUserId = s.id;
  const sw = await ensureWallet(s.id, "E2E Sender - Turbopay");
  senderWalletId = sw.wallet.id;

  // Recipient — internal Turbopay user.
  const r = await db.user.create({
    data: {
      fullName: "E2E Recipient",
      email: `e2e-recipient-${suffix}@turbopay.test`,
      phone: `+234700222${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("password123"),
      kycTier: 1,
      emailVerified: true,
    },
  });
  recipientUserId = r.id;
  const rw = await ensureWallet(r.id, "E2E Recipient - Turbopay");
  recipientWalletId = rw.wallet.id;

  sender = {
    id: s.id,
    fullName: s.fullName,
    username: null,
    email: s.email,
    phone: s.phone,
    country: "NG",
    kycTier: 2,
    kycStatus: "VERIFIED",
    status: "ACTIVE",
    emailVerified: true,
    phoneVerified: true,
    role: "USER",
    hasTransactionPin: true,
    authProvider: "password",
    createdAt: s.createdAt.toISOString(),
  };
  recipientUser = {
    id: r.id,
    fullName: r.fullName,
    username: null,
    email: r.email,
    phone: r.phone,
    country: "NG",
    kycTier: 1,
    kycStatus: "UNVERIFIED",
    status: "ACTIVE",
    emailVerified: true,
    phoneVerified: false,
    role: "USER",
    hasTransactionPin: false,
    authProvider: "password",
    createdAt: r.createdAt.toISOString(),
  };
});

afterAll(async () => {
  await db.beneficiary.deleteMany({ where: { userId: senderUserId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: senderWalletId } });
  await db.transaction.deleteMany({ where: { walletId: senderWalletId } });
  await db.wallet.deleteMany({ where: { id: senderWalletId } });
  await db.user.deleteMany({ where: { id: senderUserId } });

  await db.ledgerEntry.deleteMany({ where: { walletId: recipientWalletId } });
  await db.transaction.deleteMany({ where: { walletId: recipientWalletId } });
  await db.wallet.deleteMany({ where: { id: recipientWalletId } });
  await db.user.deleteMany({ where: { id: recipientUserId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.transaction.deleteMany({ where: { walletId: senderWalletId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: senderWalletId } });
  await db.wallet.update({ where: { id: senderWalletId }, data: { balanceKobo: 0, status: "ACTIVE" } });

  await db.transaction.deleteMany({ where: { walletId: recipientWalletId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: recipientWalletId } });
  await db.wallet.update({ where: { id: recipientWalletId }, data: { balanceKobo: 0, status: "ACTIVE" } });

  await creditWallet(senderWalletId, nairaToKobo(500_000), "FUNDING");
});

describe("internal transfer (Turbopay → Turbopay)", () => {
  it("succeeds end-to-end: debit sender, credit recipient, both ledger entries", async () => {
    const result = await transferService.send({
      user: sender,
      recipient: recipientUser.phone!,
      amountNaira: 2500,
      note: "e2e internal",
      pin: "1234",
      idemKey: null,
    });

    expect(result.ok).toBe(true);
    expect(result.amountKobo).toBe(nairaToKobo(2500));
    expect(result.feeKobo).toBe(0);

    const senderWallet = await db.wallet.findUnique({ where: { id: senderWalletId } });
    expect(senderWallet!.balanceKobo).toBe(nairaToKobo(497_500)); // 500k − 2.5k

    const recipientWallet = await db.wallet.findUnique({ where: { id: recipientWalletId } });
    expect(recipientWallet!.balanceKobo).toBe(nairaToKobo(2500));

    // Both legs on the ledger.
    expect(await getLedgerBalance(senderWalletId)).toBe(nairaToKobo(497_500));
    expect(await getLedgerBalance(recipientWalletId)).toBe(nairaToKobo(2500));

    // Transaction rows: TRANSFER_OUT on sender, TRANSFER_IN on recipient.
    const out = await db.transaction.findFirst({ where: { walletId: senderWalletId, type: "TRANSFER_OUT" } });
    expect(out!.status).toBe("SUCCESS");
    const inTx = await db.transaction.findFirst({ where: { walletId: recipientWalletId, type: "TRANSFER_IN" } });
    expect(inTx!.status).toBe("SUCCESS");
  });

  it("rejects a transfer to a non-existent recipient", async () => {
    await expect(
      transferService.send({
        user: sender,
        recipient: "+2347999999999",
        amountNaira: 500,
        pin: "1234",
        idemKey: null,
      })
    ).rejects.toMatchObject({ code: "RECIPIENT_NOT_FOUND" });
  });

  it("rejects a transfer to self", async () => {
    await expect(
      transferService.send({
        user: sender,
        recipient: sender.phone!,
        amountNaira: 500,
        pin: "1234",
        idemKey: null,
      })
    ).rejects.toMatchObject({ code: "SELF_TRANSFER" });
  });

  it("rejects an incorrect PIN", async () => {
    await expect(
      transferService.send({
        user: sender,
        recipient: recipientUser.phone!,
        amountNaira: 500,
        pin: "9999",
        idemKey: null,
      })
    ).rejects.toMatchObject({ code: "INVALID_PIN" });
  });
});

describe("external transfer (Turbopay → bank via mock provider)", () => {
  it("completes with a SUCCESS status through the hold/confirm orchestrator", async () => {
    const result = await transferService.send({
      user: sender,
      accountNumber: "0123456789",
      bankCode: "044",
      bankName: "Access Bank",
      recipientName: "ADEKUNLE O. CHIWE",
      amountNaira: 10_000,
      note: "e2e external",
      pin: "1234",
      idemKey: null,
    });

    expect(result.ok).toBe(true);
    expect(result.external).toBe(true);
    expect(result.providerRef).toBeTruthy();
    // The mock local-transfer adapter returns SUCCESS synchronously.
    expect(result.status).toBe("SUCCESS");

    const wallet = await db.wallet.findUnique({ where: { id: senderWalletId } });
    // 500k − 10k − external transfer fee (mock fee engine: no fee rows → 0).
    expect(wallet!.balanceKobo).toBe(nairaToKobo(490_000));
    expect(await getLedgerBalance(senderWalletId)).toBe(wallet!.balanceKobo);

    const tx = await db.transaction.findFirst({ where: { walletId: senderWalletId, type: "TRANSFER_OUT" } });
    expect(tx!.status).toBe("SUCCESS");
    expect(tx!.providerRef).toBe(result.providerRef);
    expect(tx!.counterpartyAccount).toBe("0123456789");
  });

  it("keeps the transaction PENDING + funds held when the provider reports PENDING", async () => {
    // Drive the orchestrator directly with a PENDING provider response
    // (the same seam the Paystack adapter uses) to prove the hold semantics.
    const { executeProviderDebit } = await import("@/lib/turbopay/payments");
    const res = await executeProviderDebit({
      userId: senderUserId,
      walletId: senderWalletId,
      type: "TRANSFER_OUT",
      refType: "TRANSFER",
      amountKobo: nairaToKobo(5_000),
      description: "async bank transfer",
      counterpartyName: "ADEKUNLE O. CHIWE",
      counterpartyAccount: "0123456789",
      counterpartyBank: "044",
      provider: "paystack",
      providerCall: async () => ({ providerRef: "PSK-E2E-1", finalStatus: "PENDING" as const, extra: { paystackStatus: "PENDING" } }),
    });

    expect(res.status).toBe("PENDING");
    const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
    expect(tx!.status).toBe("PENDING");
    // State stays PROVIDER_CALLED (not terminal) so the sweeper/settlement
    // worker or a webhook can finalize it.
    expect(tx!.state).toBe("PROVIDER_CALLED");

    // Funds are held — debited but the row is PENDING.
    const wallet = await db.wallet.findUnique({ where: { id: senderWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(495_000));
  });
});

describe("transfer failure paths", () => {
  it("throws INSUFFICIENT_FUNDS for an over-balance external transfer", async () => {
    await expect(
      transferService.send({
        user: sender,
        accountNumber: "0123456789",
        bankCode: "044",
        amountNaira: 999_999,
        pin: "1234",
        idemKey: null,
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
  });

  it("reverses the hold and refunds when the provider throws", async () => {
    const { executeProviderDebit } = await import("@/lib/turbopay/payments");
    await expect(
      executeProviderDebit({
        userId: senderUserId,
        walletId: senderWalletId,
        type: "TRANSFER_OUT",
        refType: "TRANSFER",
        amountKobo: nairaToKobo(1_000),
        description: "failing transfer",
        provider: "paystack",
        providerCall: async () => {
          throw new Error("provider timeout");
        },
      })
    ).rejects.toThrow("provider timeout");

    // Full refund — no funds stranded.
    const wallet = await db.wallet.findUnique({ where: { id: senderWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(500_000));
    expect(await getLedgerBalance(senderWalletId)).toBe(nairaToKobo(500_000));

    const tx = await db.transaction.findFirst({
      where: { walletId: senderWalletId, type: "TRANSFER_OUT" },
      orderBy: { createdAt: "desc" },
    });
    expect(tx!.status).toBe("FAILED");
    expect(tx!.state).toBe("REVERSED");
  });
});
