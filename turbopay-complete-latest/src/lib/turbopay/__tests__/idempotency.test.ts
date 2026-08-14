import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { creditWallet } from "@/lib/turbopay/ledger";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { nairaToKobo } from "@/lib/turbopay/money";
import { transferService } from "@/lib/turbopay/services/transfer.service";
import { getIdempotentResponse, startIdempotency, completeIdempotency } from "@/lib/turbopay/idempotency";
import { webhookRegistry } from "@/lib/turbocore/webhooks/registry";
import "@/lib/turbocore/webhooks/dispatcher";

/**
 * IDEMPOTENCY TESTS — duplicate payment requests and duplicate webhooks must
 * never produce duplicate financial effects.
 *
 *   • Transfer service: a retried request with the same idempotency key
 *     returns the cached response and does NOT debit again.
 *   • Concurrent requests with the same key: exactly one starts, the other
 *     is rejected with IDEMPOTENCY_INFLIGHT.
 *   • Duplicate webhooks: the (provider, providerRef) unique constraint +
 *     PROCESSED lookup mean the business logic (wallet credit) runs once.
 */

let testUserId: string;
let testWalletId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const user = await db.user.create({
    data: {
      fullName: "Idempotency Test",
      email: `idem-${suffix}@turbopay.test`,
      phone: `+234711000${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      transactionPinHash: hashPassword("1234"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "Idempotency Test - Turbopay");
  testWalletId = wallet.id;
});

afterAll(async () => {
  await db.idempotencyRecord.deleteMany({ where: { userId: testUserId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.idempotencyRecord.deleteMany({ where: { userId: testUserId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  const wallet = await db.wallet.findUnique({ where: { id: testWalletId }, select: { id: true } });
  if (wallet) {
    await db.wallet.update({ where: { id: testWalletId }, data: { balanceKobo: 0, status: "ACTIVE" } });
  }
  await creditWallet(testWalletId, nairaToKobo(100_000), "FUNDING");
});

const testUser = () => ({
  id: testUserId,
  fullName: "Idempotency Test",
  phone: "+2347110000000",
});

describe("transfer idempotency", () => {
  it("a duplicate request with the same idempotency key does NOT debit twice", async () => {
    // Create a real internal recipient + wallet.
    const suffix = Math.floor(Math.random() * 1_000_000).toString();
    const rec = await db.user.create({
      data: {
        fullName: "Idem Recipient",
        email: `idem-rec-${suffix}@turbopay.test`,
        phone: `+234744000${suffix.padStart(4, "0").slice(-4)}`,
        passwordHash: hashPassword("x"),
        kycTier: 1,
      },
    });
    await ensureWallet(rec.id, "Idem Recipient - Turbopay");

    // A key that fails (bad recipient) must NOT be cached as complete.
    const badKey = `idem-bad-${Date.now()}-${Math.random()}`;
    await expect(
      transferService.send({
        user: { ...testUser(), kycTier: 2 } as any,
        recipient: "internal-recipient@doesnotexist.test",
        amountNaira: 1000,
        pin: "1234",
        idemKey: badKey,
      })
    ).rejects.toMatchObject({ code: "RECIPIENT_NOT_FOUND" });

    const idemKey2 = `idem-ok-${Date.now()}-${Math.random()}`;
    const ok1 = await transferService.send({
      user: { ...testUser(), kycTier: 2 } as any,
      recipient: `+234744000${suffix.padStart(4, "0").slice(-4)}`,
      amountNaira: 1000,
      pin: "1234",
      idemKey: idemKey2,
    });
    expect(ok1.ok).toBe(true);

    const before = await db.wallet.findUnique({ where: { id: testWalletId } });
    // Retry with the SAME key — must return the cached body and NOT debit.
    const ok2 = await transferService.send({
      user: { ...testUser(), kycTier: 2 } as any,
      recipient: `+234744000${suffix.padStart(4, "0").slice(-4)}`,
      amountNaira: 1000,
      pin: "1234",
      idemKey: idemKey2,
    });
    expect(ok2.ok).toBe(true);
    expect(ok2.reference).toBe(ok1.reference);

    const after = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(after!.balanceKobo).toBe(before!.balanceKobo); // NOT debited again

    // Clean up the recipient created in this test.
    await db.ledgerEntry.deleteMany({ where: { wallet: { userId: rec.id } } });
    await db.transaction.deleteMany({ where: { wallet: { userId: rec.id } } });
    await db.wallet.deleteMany({ where: { userId: rec.id } });
    await db.user.deleteMany({ where: { id: rec.id } });
  });

  it("concurrent requests with the same idempotency key: exactly one starts", async () => {
    const idemKey = `idem-race-${Date.now()}-${Math.random()}`;
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        transferService.send({
          user: { ...testUser(), kycTier: 2 } as any,
          recipient: "nobody@nowhere.test",
          amountNaira: 500,
          pin: "1234",
          idemKey,
        })
      )
    );

    // The recipient doesn't exist, so the request that WON the idempotency
    // insert fails with RECIPIENT_NOT_FOUND; the concurrent twins lose the
    // unique-constraint race and are rejected with IDEMPOTENCY_INFLIGHT.
    const winners = results.filter((r) => r.status === "rejected" && (r.reason as any)?.code === "RECIPIENT_NOT_FOUND");
    const losers = results.filter((r) => r.status === "rejected" && (r.reason as any)?.code === "IDEMPOTENCY_INFLIGHT");
    expect(winners.length).toBe(1); // exactly one proceeded
    expect(losers.length).toBe(results.length - 1); // every twin was rejected
  });

  it("getIdempotentResponse returns a hit only after completion", async () => {
    const key = `idem-unit-${Date.now()}`;
    const miss = await getIdempotentResponse(key);
    expect(miss.hit).toBe(false);

    const started = await startIdempotency(key, "/api/transfer", testUserId);
    expect(started.started).toBe(true);

    // Still incomplete — no hit.
    const mid = await getIdempotentResponse(key);
    expect(mid.hit).toBe(false);

    await completeIdempotency(key, 200, { ok: true, reference: "TP-X" });

    const hit = await getIdempotentResponse<{ reference: string }>(key);
    expect(hit.hit).toBe(true);
    if (hit.hit) expect(hit.body.reference).toBe("TP-X");

    // A second start with the same key must fail (unique constraint).
    const again = await startIdempotency(key, "/api/transfer", testUserId);
    expect(again.started).toBe(false);
  });
});

describe("webhook idempotency", () => {
  it("a duplicate funding webhook credits the wallet exactly once", async () => {
    const providerRef = `MNF-IDEM-${Date.now()}`;
    const payload = {
      eventType: "SUCCESSFUL_COLLECTION",
      eventData: {
        transactionReference: providerRef,
        accountReference: (await db.virtualAccount.findFirst({ where: { userId: testUserId } }))!.accountNumber,
        amountPaid: "2500",
        paymentReference: `TP-IDEM-${Date.now()}`,
        paidAt: new Date().toISOString(),
      },
    };
    const rawBody = JSON.stringify(payload);

    const r1 = await webhookRegistry.process("monnify", {
      rawBody,
      headers: { "x-turbopay-demo": "1" },
      parsedPayload: payload,
    });
    expect(r1.status).toBe(200);

    // Duplicate delivery — must be acknowledged as duplicate, NOT re-credited.
    const r2 = await webhookRegistry.process("monnify", {
      rawBody,
      headers: { "x-turbopay-demo": "1" },
      parsedPayload: payload,
    });
    expect(r2.body.status).toBe("duplicate");

    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    // 100_000 (funding) + 2500 — exactly one credit.
    expect(wallet!.balanceKobo).toBe(nairaToKobo(100_000) + nairaToKobo(2500));

    // Exactly one FUNDING ledger entry for the webhook amount (the
    // beforeEach 100_000 credit is separate).
    const credits = await db.ledgerEntry.findMany({
      where: { walletId: testWalletId, refType: "FUNDING", amountKobo: nairaToKobo(2500) },
    });
    expect(credits.length).toBe(1);
    // And exactly one Transaction row with this providerRef.
    const txRows = await db.transaction.findMany({ where: { provider: "monnify", providerRef } });
    expect(txRows.length).toBe(1);
  });
});
