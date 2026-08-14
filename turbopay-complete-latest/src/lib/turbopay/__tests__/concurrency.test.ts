import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { creditWallet, debitWallet, getLedgerBalance } from "@/lib/turbopay/ledger";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { nairaToKobo } from "@/lib/turbopay/money";
import { webhookRegistry } from "@/lib/turbocore/webhooks/registry";
import "@/lib/turbocore/webhooks/dispatcher";

/**
 * CONCURRENCY TESTS — real parallel financial operations against PostgreSQL.
 *
 * These tests fire genuinely-parallel writes (Promise.all, not a sequential
 * loop) and verify the FINAL wallet/ledger state stays correct:
 *   • Parallel debits against one balance → conditional UPDATE means the
 *     total debited never exceeds the available balance, balance >= 0.
 *   • Parallel credits → every credit lands (no lost updates).
 *   • Parallel debits + credits mixed → ledger sum matches wallet cache.
 *   • Parallel duplicate webhooks → exactly one wallet credit.
 *
 * The per-user advisory lock (pg_advisory_xact_lock) serializes debits for
 * the same user; the conditional UPDATE is the last line of defense.
 */

let testUserId: string;
let testWalletId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const user = await db.user.create({
    data: {
      fullName: "Concurrency Test",
      email: `conc-${suffix}@turbopay.test`,
      phone: `+234788000${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "Concurrency Test - Turbopay");
  testWalletId = wallet.id;
});

afterAll(async () => {
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  const wallet = await db.wallet.findUnique({ where: { id: testWalletId }, select: { id: true } });
  if (wallet) {
    await db.wallet.update({ where: { id: testWalletId }, data: { balanceKobo: 0, status: "ACTIVE" } });
  }
});

describe("parallel wallet operations", () => {
  it("20 parallel debits against a fixed balance never overdraw", async () => {
    await creditWallet(testWalletId, nairaToKobo(10_000), "FUNDING"); // ₦10,000

    const AMOUNT = nairaToKobo(800); // ₦800 × 20 = ₦16,000 > ₦10,000
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        debitWallet(testWalletId, AMOUNT, "AIRTIME", { userId: testUserId, description: "parallel debit" })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    // 800 × 12 = 9,600 <= 10,000; the 13th would overdraw.
    expect(succeeded).toBe(12);

    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(10_000) - 12 * AMOUNT);
    expect(wallet!.balanceKobo).toBeGreaterThanOrEqual(0);
    // Ledger agrees with the wallet cache.
    expect(await getLedgerBalance(testWalletId)).toBe(wallet!.balanceKobo);
  });

  it("50 parallel credits all land (no lost updates)", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        creditWallet(testWalletId, nairaToKobo(100), "FUNDING", { refId: `p-credit-${i}` })
      )
    );
    expect(results.length).toBe(50);

    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(100) * 50);
    expect(await getLedgerBalance(testWalletId)).toBe(wallet!.balanceKobo);
  });

  it("mixed parallel debits + credits leave cache == ledger", async () => {
    await creditWallet(testWalletId, nairaToKobo(5_000), "FUNDING");

    const ops: Promise<unknown>[] = [
      // 10 credits of ₦500
      ...Array.from({ length: 10 }, (_, i) => creditWallet(testWalletId, nairaToKobo(500), "FUNDING", { refId: `mix-c-${i}` })),
      // 8 debits of ₦300
      ...Array.from({ length: 8 }, (_, i) =>
        debitWallet(testWalletId, nairaToKobo(300), "DATA", { userId: testUserId, refId: `mix-d-${i}` }).catch(() => null)
      ),
    ];
    await Promise.all(ops);

    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    // 5000 + 10×500 − 8×300 = 5000 + 5000 − 2400 = 7600
    expect(wallet!.balanceKobo).toBe(nairaToKobo(7_600));
    expect(await getLedgerBalance(testWalletId)).toBe(wallet!.balanceKobo);
  });

  it("parallel debitWallet with same userId is serialized by the advisory lock", async () => {
    await creditWallet(testWalletId, nairaToKobo(3_000), "FUNDING");
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        debitWallet(testWalletId, nairaToKobo(600), "AIRTIME", { userId: testUserId })
      )
    );
    // 600 × 5 = 3000 exactly; the 6th overdraws.
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(5);
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(0);
  });
});

describe("parallel webhook dedup", () => {
  it("10 parallel deliveries of the same funding webhook credit once", async () => {
    const providerRef = `MNF-PAR-${Date.now()}`;
    const vaccount = await db.virtualAccount.findFirst({ where: { userId: testUserId } });
    const payload = {
      eventType: "SUCCESSFUL_COLLECTION",
      eventData: {
        transactionReference: providerRef,
        accountReference: vaccount!.accountNumber,
        amountPaid: "900",
        paymentReference: `TP-PAR-${Date.now()}`,
        paidAt: new Date().toISOString(),
      },
    };
    const rawBody = JSON.stringify(payload);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        webhookRegistry.process("monnify", { rawBody, headers: { "x-turbopay-demo": "1" }, parsedPayload: payload })
      )
    );

    const bodies = results.map((r) => (r.status === "fulfilled" ? r.value.body.status : "rejected"));
    // Exactly one 'ok' — the rest must be 'duplicate' or (in a rare race) the
    // P2002 loser. Never a second 'ok'.
    expect(bodies.filter((s) => s === "ok").length).toBe(1);

    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(900)); // credited exactly once

    const rows = await db.webhookEvent.findMany({ where: { provider: "monnify", providerRef } });
    expect(rows.length).toBe(1);
  });
});
