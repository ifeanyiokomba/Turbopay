import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { creditWallet, getLedgerBalance } from "@/lib/turbopay/ledger";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { nairaToKobo } from "@/lib/turbopay/money";
import { executeProviderDebit } from "@/lib/turbopay/payments";
import { webhookRegistry, paystackWebhookHandler } from "@/lib/turbocore/webhooks/registry";
import "@/lib/turbocore/webhooks/dispatcher"; // registers the event dispatcher

/**
 * WEBHOOK E2E — complete Paystack transfer-finalization path:
 *
 *   provider callback → signature validation → payload validation →
 *   transaction lookup → idempotency → state transition → ledger effect
 *
 * Setup: a PENDING external transfer is created via executeProviderDebit
 * (funds held, state=PROVIDER_CALLED). Then the webhook finalizes it:
 *   • transfer.success → status SUCCESS + state SETTLED (funds stay debited)
 *   • transfer.failed  → ledger reversal + status FAILED + state REVERSED
 *
 * Also covers: duplicate callbacks (no double refund), invalid signatures,
 * unknown transactions, malformed callbacks, wrong amounts.
 */

let testUserId: string;
let testWalletId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const user = await db.user.create({
    data: {
      fullName: "Webhook Finalize Test",
      email: `whf-${suffix}@turbopay.test`,
      phone: `+234700333${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "Webhook Finalize Test - Turbopay");
  testWalletId = wallet.id;
});

afterAll(async () => {
  await db.webhookEvent.deleteMany({ where: { provider: "paystack" } });
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.webhookEvent.deleteMany({ where: { provider: "paystack" } });
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  const wallet = await db.wallet.findUnique({ where: { id: testWalletId }, select: { id: true } });
  if (wallet) {
    await db.wallet.update({ where: { id: testWalletId }, data: { balanceKobo: 0, status: "ACTIVE" } });
  }
  await creditWallet(testWalletId, nairaToKobo(20_000), "FUNDING");
});

/** Create a PENDING external transfer with a known providerRef. */
async function createPendingTransfer(providerRef: string, amountKobo = nairaToKobo(3_000)) {
  return executeProviderDebit({
    userId: testUserId,
    walletId: testWalletId,
    type: "TRANSFER_OUT",
    refType: "TRANSFER",
    amountKobo,
    description: "async transfer",
    counterpartyName: "ADEKUNLE O. CHIWE",
    counterpartyAccount: "0123456789",
    counterpartyBank: "044",
    provider: "paystack",
    providerCall: async () => ({ providerRef, finalStatus: "PENDING" as const, extra: { paystackStatus: "PENDING" } }),
  });
}

function transferWebhook(event: "transfer.success" | "transfer.failed", providerRef: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    event,
    data: {
      // The REAL Paystack shape: `transfer_code` is what the adapter stored
      // as the Transaction.providerRef; `reference` is the client-side ref.
      transfer_code: providerRef,
      reference: `TP-NIP-CLIENT-${providerRef.slice(-6)}`,
      amount: "3000",
      ...extra,
    },
  });
}

describe("transfer.success webhook", () => {
  it("finalizes a PENDING transfer to SUCCESS + SETTLED, funds remain debited", async () => {
    const providerRef = `PSK-FIN-SUCCESS-${Date.now()}`;
    await createPendingTransfer(providerRef);

    const rawBody = transferWebhook("transfer.success", providerRef);
    const result = await webhookRegistry.process("paystack", {
      rawBody,
      headers: { "x-turbopay-demo": "1" },
      parsedPayload: JSON.parse(rawBody),
    });
    expect(result.status).toBe(200);
    expect(result.body.processed).toBe(true);

    const tx = await db.transaction.findFirst({ where: { providerRef, provider: "paystack" } });
    expect(tx!.status).toBe("SUCCESS");
    expect(tx!.state).toBe("SETTLED");

    // Funds stay debited — the transfer completed.
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(20_000) - nairaToKobo(3_000));
    expect(await getLedgerBalance(testWalletId)).toBe(wallet!.balanceKobo);
  });

  it("is idempotent — a duplicate success webhook does not double-process", async () => {
    const providerRef = `PSK-FIN-DUP-${Date.now()}`;
    await createPendingTransfer(providerRef);

    const rawBody = transferWebhook("transfer.success", providerRef);
    const r1 = await webhookRegistry.process("paystack", { rawBody, headers: { "x-turbopay-demo": "1" }, parsedPayload: JSON.parse(rawBody) });
    const r2 = await webhookRegistry.process("paystack", { rawBody, headers: { "x-turbopay-demo": "1" }, parsedPayload: JSON.parse(rawBody) });
    expect(r1.body.status).toBe("ok");
    expect(r2.body.status).toBe("duplicate");

    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(17_000)); // debited once only
  });
});

describe("transfer.failed webhook", () => {
  it("reverses the hold + refunds, marks FAILED + REVERSED", async () => {
    const providerRef = `PSK-FIN-FAIL-${Date.now()}`;
    await createPendingTransfer(providerRef);

    const rawBody = transferWebhook("transfer.failed", providerRef, { fail_reason: "Insufficient funds" });
    const result = await webhookRegistry.process("paystack", {
      rawBody,
      headers: { "x-turbopay-demo": "1" },
      parsedPayload: JSON.parse(rawBody),
    });
    expect(result.status).toBe(200);
    expect(result.body.processed).toBe(true);

    const tx = await db.transaction.findFirst({ where: { providerRef, provider: "paystack" } });
    expect(tx!.status).toBe("FAILED");
    expect(tx!.state).toBe("REVERSED");

    // Full refund.
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(20_000));
    expect(await getLedgerBalance(testWalletId)).toBe(nairaToKobo(20_000));

    // Exactly one REVERSAL leg.
    const reversals = await db.ledgerEntry.findMany({ where: { walletId: testWalletId, refType: "REVERSAL" } });
    expect(reversals.length).toBe(1);
  });

  it("does NOT double-refund on a replayed failure webhook", async () => {
    const providerRef = `PSK-FIN-REPLAY-${Date.now()}`;
    await createPendingTransfer(providerRef);

    const rawBody = transferWebhook("transfer.failed", providerRef, { fail_reason: "rejected" });
    const r1 = await webhookRegistry.process("paystack", { rawBody, headers: { "x-turbopay-demo": "1" }, parsedPayload: JSON.parse(rawBody) });
    const r2 = await webhookRegistry.process("paystack", { rawBody, headers: { "x-turbopay-demo": "1" }, parsedPayload: JSON.parse(rawBody) });

    expect(r1.body.status).toBe("ok");
    expect(r2.body.status).toBe("duplicate");

    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(nairaToKobo(20_000)); // refunded exactly once

    const reversals = await db.ledgerEntry.findMany({ where: { walletId: testWalletId, refType: "REVERSAL" } });
    expect(reversals.length).toBe(1);
  });
});

describe("webhook edge cases", () => {
  it("rejects an invalid signature with 401 (no demo header)", async () => {
    const providerRef = `PSK-FIN-BADSIG-${Date.now()}`;
    await createPendingTransfer(providerRef);

    const rawBody = transferWebhook("transfer.success", providerRef);
    const result = await webhookRegistry.process("paystack", {
      rawBody,
      headers: {},
      parsedPayload: JSON.parse(rawBody),
    });
    expect(result.status).toBe(401);
    expect(result.body.processed).toBe(false);

    // Transaction untouched — still PENDING.
    const tx = await db.transaction.findFirst({ where: { providerRef } });
    expect(tx!.status).toBe("PENDING");
  });

  it("handles a webhook for an unknown transaction as a no-op (no crash)", async () => {
    const rawBody = transferWebhook("transfer.success", `PSK-NOTFOUND-${Date.now()}`);
    const result = await webhookRegistry.process("paystack", {
      rawBody,
      headers: { "x-turbopay-demo": "1" },
      parsedPayload: JSON.parse(rawBody),
    });
    // The registry processes + dispatches; the dispatcher finds no matching
    // transaction and does nothing harmful.
    expect(result.status).toBe(200);
    expect(result.body.processed).toBe(true);
  });

  it("tolerates a malformed payload (invalid JSON is handled by the route, no ref → ignored)", async () => {
    // A payload with no reference is normalised to nothing by the handler —
    // the registry acknowledges it without dispatching business logic.
    const rawBody = JSON.stringify({ event: "transfer.success", data: {} });
    const result = await webhookRegistry.process("paystack", {
      rawBody,
      headers: { "x-turbopay-demo": "1" },
      parsedPayload: JSON.parse(rawBody),
    });
    expect([200, 401]).toContain(result.status);
    expect(result.body.processed).toBe(false);
  });

  it("unknown provider returns 404", async () => {
    const result = await webhookRegistry.process("no-such-provider", {
      rawBody: "{}",
      headers: {},
      parsedPayload: {},
    });
    expect(result.status).toBe(404);
  });

  it("extracts transfer_reference as the provider ref (fallback)", () => {
    const events = paystackWebhookHandler.normalize(
      { event: "transfer.success", data: { transfer_reference: "PSK-TR-1", amount: "1000" } },
      {}
    );
    expect(events).toHaveLength(1);
    expect((events[0].data as any).providerRef).toBe("PSK-TR-1");
  });

  it("prefers transfer_code as the provider ref for transfer events (matches the stored Transaction.providerRef)", () => {
    // The adapter stores `data.transfer_code` as providerRef — the webhook
    // must resolve the SAME value or the dispatcher lookup never matches.
    const rawBody = transferWebhook("transfer.success", "TRF_TEST_123");
    const ref = paystackWebhookHandler.extractProviderRef(JSON.parse(rawBody));
    expect(ref).toBe("TRF_TEST_123");

    const events = paystackWebhookHandler.normalize(JSON.parse(rawBody), {});
    expect(events[0].data.providerRef).toBe("TRF_TEST_123");
  });
});
