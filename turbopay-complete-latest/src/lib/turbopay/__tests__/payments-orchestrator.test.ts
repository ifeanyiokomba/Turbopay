import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { creditWallet } from "@/lib/turbopay/ledger";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { nairaToKobo } from "@/lib/turbopay/money";
import { executeProviderDebit } from "@/lib/turbopay/payments";

/**
 * PAYMENT ORCHESTRATOR TESTS — async finalization + hold/reverse semantics.
 *
 * Paystack-style providers return PENDING synchronously and finalize via
 * webhook. The orchestrator must keep the transaction PENDING in that case
 * (so a later failure webhook can reverse + refund) instead of marking a
 * false SUCCESS.
 */

let testUserId: string;
let testWalletId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const user = await db.user.create({
    data: {
      fullName: "Payments Test",
      email: `pmt-${suffix}@turbopay.test`,
      phone: `+234701${suffix.slice(0, 7)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "Payments Test - Turbopay");
  testWalletId = wallet.id;
});

afterAll(async () => {
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

describe("executeProviderDebit — async provider finalization", () => {
  beforeEach(async () => {
    await db.transaction.deleteMany({ where: { walletId: testWalletId } });
    await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId }, select: { id: true } });
    if (wallet) {
      await db.wallet.update({ where: { id: testWalletId }, data: { balanceKobo: 0, status: "ACTIVE" } });
    }
    await creditWallet(testWalletId, nairaToKobo(5000), "FUNDING");
  });

  it("keeps the transaction PENDING when the provider returns PENDING (webhook finalizes later)", async () => {
    const res = await executeProviderDebit({
      userId: testUserId,
      walletId: testWalletId,
      type: "TRANSFER_OUT",
      refType: "TRANSFER",
      amountKobo: nairaToKobo(1000),
      description: "async transfer",
      provider: "paystack",
      providerCall: async () => ({ providerRef: "PSK-ASYNC-1", finalStatus: "PENDING" as const }),
    });

    expect(res.status).toBe("PENDING");
    const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
    expect(tx!.status).toBe("PENDING");
    expect(tx!.providerRef).toBe("PSK-ASYNC-1");
    // Funds are held (debited) until the webhook finalizes.
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(4000));
  });

  it("marks the transaction SUCCESS when the provider confirms synchronously", async () => {
    const res = await executeProviderDebit({
      userId: testUserId,
      walletId: testWalletId,
      type: "TRANSFER_OUT",
      refType: "TRANSFER",
      amountKobo: nairaToKobo(1000),
      description: "sync transfer",
      provider: "paystack",
      providerCall: async () => ({ providerRef: "PSK-SYNC-1", finalStatus: "SUCCESS" as const }),
    });

    expect(res.status).toBe("SUCCESS");
    const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
    expect(tx!.status).toBe("SUCCESS");
    expect(tx!.providerRef).toBe("PSK-SYNC-1");
  });

  it("defaults to SUCCESS when the provider call omits finalStatus", async () => {
    const res = await executeProviderDebit({
      userId: testUserId,
      walletId: testWalletId,
      type: "AIRTIME",
      refType: "AIRTIME",
      amountKobo: nairaToKobo(500),
      description: "airtime",
      provider: "baxi",
      providerCall: async () => ({ providerRef: "BAX-1" }),
    });
    expect(res.status).toBe("SUCCESS");
    const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
    expect(tx!.status).toBe("SUCCESS");
  });

  it("reverses the hold and refunds the wallet when the provider call throws", async () => {
    await expect(
      executeProviderDebit({
        userId: testUserId,
        walletId: testWalletId,
        type: "TRANSFER_OUT",
        refType: "TRANSFER",
        amountKobo: nairaToKobo(1000),
        description: "failing transfer",
        provider: "paystack",
        providerCall: async () => {
          throw new Error("provider down");
        },
      })
    ).rejects.toThrow("provider down");

    // Full refund — no funds stranded.
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(5000));
    const tx = await db.transaction.findFirst({
      where: { walletId: testWalletId, type: "TRANSFER_OUT" },
      orderBy: { createdAt: "desc" },
    });
    expect(tx!.status).toBe("FAILED");
  });
});
