import * as crypto from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { creditWallet } from "@/lib/turbopay/ledger";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { nairaToKobo } from "@/lib/turbopay/money";
import { webhookRegistry, monnifyWebhookHandler } from "@/lib/turbocore/webhooks/registry";

/**
 * Webhook Framework tests — verify signature verification, idempotency, and
 * normalisation for the Monnify handler.
 */

let testUserId: string;
let testWalletId: string;
let testAccountNumber: string;

beforeEach(async () => {
  // Clean up any stale WebhookEndpoint rows so the demo bypass works.
  try {
    await db.webhookEndpoint.deleteMany({});
  } catch {
    // SQLite socket timeout under concurrent load — safe to skip
  }

  // Create a fresh test user + wallet for each test.
  const suffix = crypto.randomBytes(4).toString("hex");
  const user = await db.user.create({
    data: {
      fullName: "Webhook Test",
      email: `wh-test-${suffix}@turbopay.test`,
      phone: `+234700${suffix.slice(0, 7)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  const { wallet, vaccount } = await ensureWallet(user.id, "Webhook Test - Turbopay");
  testWalletId = wallet.id;
  testAccountNumber = vaccount.accountNumber;
});

describe("Webhook Framework", () => {
  it("registry has monnify + intl-receiving handlers registered", () => {
    const providers = webhookRegistry.list();
    expect(providers).toContain("monnify");
    expect(providers).toContain("intl-receiving");
  });

  it("monnify handler rejects invalid signature (no secret, no demo header)", async () => {
    const rawBody = JSON.stringify({ eventData: { transactionReference: "MNF-1", accountReference: testAccountNumber, amountPaid: "1000" } });
    const result = await webhookRegistry.process("monnify", { rawBody, headers: {}, parsedPayload: JSON.parse(rawBody) });
    expect(result.status).toBe(401);
    expect(result.body.processed).toBe(false);
  });

  it("monnify handler accepts demo requests (X-Turbopay-Demo header)", async () => {
    const rawBody = JSON.stringify({
      eventData: {
        transactionReference: `MNF-DEMO-${Date.now()}`,
        accountReference: testAccountNumber,
        amountPaid: "1000",
        paymentReference: `TP-${Date.now()}`,
      },
    });
    const result = await webhookRegistry.process("monnify", {
      rawBody,
      headers: { "x-turbopay-demo": "1" },
      parsedPayload: JSON.parse(rawBody),
    });
    expect(result.status).toBe(200);
    // processed may be true or duplicate depending on timing; both are valid 200s
  });

  it("monnify handler is idempotent — duplicate providerRef not re-processed", async () => {
    const providerRef = `MNF-DUP-${Date.now()}`;
    const rawBody = JSON.stringify({
      eventData: {
        transactionReference: providerRef,
        accountReference: testAccountNumber,
        amountPaid: "500",
        paymentReference: `TP-${Date.now()}`,
      },
    });
    const r1 = await webhookRegistry.process("monnify", { rawBody, headers: { "x-turbopay-demo": "1" }, parsedPayload: JSON.parse(rawBody) });
    expect(r1.status).toBe(200);
    // Second call with the same providerRef should be flagged duplicate.
    const r2 = await webhookRegistry.process("monnify", { rawBody, headers: { "x-turbopay-demo": "1" }, parsedPayload: JSON.parse(rawBody) });
    expect(r2.body.status).toBe("duplicate");
  });

  it("monnify handler normalises payload into WALLET_FUNDED event", () => {
    const payload = { eventType: "SUCCESSFUL_COLLECTION", eventData: { transactionReference: "MNF-NORM-1", accountReference: "1234567890", amountPaid: "2000", paymentReference: "TP-NORM-1" } };
    const events = monnifyWebhookHandler.normalize(payload, {});
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("WALLET_FUNDED");
    expect((events[0].data as any).accountNumber).toBe("1234567890");
    expect((events[0].data as any).amountMinor).toBe(nairaToKobo(2000));
  });

  it("unknown provider returns 404", async () => {
    const result = await webhookRegistry.process("unknown-provider", { rawBody: "{}", headers: {}, parsedPayload: {} });
    expect(result.status).toBe(404);
  });

  // ─── Phase 1, Task 1: Production demo-bypass rejection for ALL handlers ──
  // The x-turbopay-demo header MUST be rejected when NODE_ENV=production,
  // for every registered handler — not just Monnify.
  const ALL_HANDLERS = [
    "monnify", "intl-receiving", "paystack", "baxi", "flutterwave",
    "wise", "stripe-issuing", "dojah", "termii", "resend",
  ];

  for (const provider of ALL_HANDLERS) {
    it(`rejects X-Turbopay-Demo header when NODE_ENV=production (${provider})`, async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      (process.env as any).NODE_ENV = "production";
      try {
        // Clean up any DB-stored secrets so we're testing the env-fallback path.
        await db.webhookEndpoint.deleteMany({});

        const rawBody = JSON.stringify({ eventData: { providerRef: `PROD-TEST-${provider}-${Date.now()}` } });
        const result = await webhookRegistry.process(provider, {
          rawBody,
          headers: { "x-turbopay-demo": "1" },
          parsedPayload: JSON.parse(rawBody),
        });
        // In production, the demo header MUST be rejected.
        expect(result.status).toBe(401);
        expect(result.body.processed).toBe(false);
      } finally {
        (process.env as any).NODE_ENV = originalNodeEnv;
      }
    });
  }

  // ─── Phase 1, Task 3: F5 — Webhook replay protection (maxAgeMs) ──────
  it("rejects stale webhooks outside the maxAgeMs replay window", async () => {
    const staleTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const rawBody = JSON.stringify({
      eventData: {
        transactionReference: `MNF-STALE-${Date.now()}`,
        accountReference: testAccountNumber,
        amountPaid: "500",
        paymentReference: `TP-STALE-${Date.now()}`,
        paidAt: staleTime,
      },
    });
    const result = await webhookRegistry.process("monnify", {
      rawBody,
      headers: { "x-turbopay-demo": "1" },
      parsedPayload: JSON.parse(rawBody),
    });
    expect(result.status).toBe(401);
    expect(result.body.processed).toBe(false);
  });

  it("accepts fresh webhooks within the maxAgeMs replay window", async () => {
    const freshTime = new Date(Date.now() - 60 * 1000).toISOString();
    const rawBody = JSON.stringify({
      eventData: {
        transactionReference: `MNF-FRESH-${Date.now()}`,
        accountReference: testAccountNumber,
        amountPaid: "500",
        paymentReference: `TP-FRESH-${Date.now()}`,
        paidAt: freshTime,
      },
    });
    const result = await webhookRegistry.process("monnify", {
      rawBody,
      headers: { "x-turbopay-demo": "1" },
      parsedPayload: JSON.parse(rawBody),
    });
    expect(result.status).toBe(200);
  });
});
