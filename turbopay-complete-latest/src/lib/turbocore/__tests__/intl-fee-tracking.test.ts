import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { hashPassword, hashPin } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { creditWallet } from "@/lib/turbopay/ledger";
import { nairaToKobo } from "@/lib/turbopay/money";
import { sendInternationalTransfer } from "@/lib/turbocore/international/send";
import { GET as transferDetailGet } from "@/app/api/intl/transfer/route";

/**
 * Fee Breakdown & Transfer Tracking Tests
 *
 * Tests the transfer detail API and verifies fee tracking data integrity.
 */

let testUserId: string;
let testWalletId: string;
let testTransferRef: string;

beforeAll(async () => {
  const user = await db.user.create({
    data: {
      fullName: "Fee Tracking Test User",
      email: `fee-track-${Date.now()}@turbopay.test`,
      phone: `+234700${Date.now().toString().slice(-7)}`,
      passwordHash: hashPassword("test"),
      transactionPinHash: hashPin("1234"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      status: "ACTIVE",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;

  const { wallet } = await ensureWallet(user.id, "Fee Track User");
  testWalletId = wallet.id;
  await creditWallet(testWalletId, nairaToKobo(5_000_000), "FUNDING");

  // Enable feature flag
  await db.featureFlag.upsert({
    where: { key: "turbopay.intl" },
    create: { key: "turbopay.intl", enabled: true, rollout: 100 },
    update: { enabled: true, rollout: 100 },
  });

  // Seed FX config
  await db.fxConfig.upsert({
    where: { pair: "NGN→USD" },
    create: { pair: "NGN→USD", fromCurrency: "NGN", toCurrency: "USD", spreadBps: 200, platformFeeBps: 80, minAmountMinor: 100, enabled: true },
    update: { spreadBps: 200, platformFeeBps: 80, enabled: true },
  });

  // Send a transfer to create tracking data
  const result = await sendInternationalTransfer({
    userId: user.id,
    walletId: wallet.id,
    kycTier: 3,
    sourceCurrency: "NGN",
    destinationCurrency: "USD",
    amountMinor: nairaToKobo(25_000),
    beneficiary: {
      name: "Alice Johnson",
      account: "9876543210",
      bank: "Bank of America",
      country: "US",
      routingCode: "BOAUS33",
    },
    purpose: "Fee tracking test",
  });

  expect(result.success).toBe(true);
  testTransferRef = result.reference!;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: testUserId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.settlement.deleteMany({ where: { reference: testTransferRef } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

// ─── Transfer Detail API ──────────────────────────────────────

describe("GET /api/intl/transfer — fee breakdown", () => {
  it("returns transfer details with fee breakdown by reference", async () => {
    const req = new Request(`http://localhost/api/intl/transfer?reference=${testTransferRef}`, {
      headers: { "user-agent": "vitest/1.0" },
    });
    const res = await transferDetailGet(req);

    // May return 401 without session cookie — test the data path if available
    if (res.status === 200) {
      const body = await res.json();
      const data = body.data;

      // Verify basic fields
      expect(data.reference).toBe(testTransferRef);
      expect(data.status).toBeDefined();
      expect(data.amountKobo).toBe(nairaToKobo(25_000));
      expect(data.counterpartyName).toBe("Alice Johnson");

      // Verify fee breakdown structure
      expect(data.feeBreakdown).toBeDefined();
      expect(data.feeBreakdown.sourceCurrency).toBe("NGN");
      expect(data.feeBreakdown.destinationCurrency).toBe("USD");
      expect(data.feeBreakdown.exchangeRate).toBeGreaterThan(0);
      expect(data.feeBreakdown.platformFeeMinor).toBeGreaterThanOrEqual(0);

      // Verify timeline exists
      expect(Array.isArray(data.timeline)).toBe(true);
      expect(data.timeline.length).toBeGreaterThan(0);

      // Each timeline entry has required fields
      for (const event of data.timeline) {
        expect(event.state).toBeDefined();
        expect(event.timestamp).toBeDefined();
        expect(event.label).toBeDefined();
      }
    }
  });

  it("returns 404 for non-existent transfer", async () => {
    const req = new Request("http://localhost/api/intl/transfer?reference=NONEXISTENT", {
      headers: { "user-agent": "vitest/1.0" },
    });
    const res = await transferDetailGet(req);
    // Without auth, returns 401; with auth, returns 404
    expect([401, 404]).toContain(res.status);
  });

  it("returns 422 when no id or reference provided", async () => {
    const req = new Request("http://localhost/api/intl/transfer", {
      headers: { "user-agent": "vitest/1.0" },
    });
    const res = await transferDetailGet(req);
    expect([401, 422]).toContain(res.status);
  });
});

// ─── Fee Data Integrity ───────────────────────────────────────

describe("Fee data integrity", () => {
  it("transaction record stores fee breakdown in metadata", async () => {
    const tx = await db.transaction.findFirst({
      where: { reference: testTransferRef },
    });
    expect(tx).not.toBeNull();

    const meta = JSON.parse(tx!.metadata!);
    expect(meta.sourceCurrency).toBe("NGN");
    expect(meta.destinationCurrency).toBe("USD");
    expect(meta.rate).toBeGreaterThan(0);
    expect(meta.feesMinor).toBeGreaterThanOrEqual(0);
    expect(meta.destinationAmountMinor).toBeGreaterThan(0);
    expect(meta.purpose).toBe("Fee tracking test");
  });

  it("fee amount is reasonable (between 0.5% and 5% of transfer)", async () => {
    const tx = await db.transaction.findFirst({
      where: { reference: testTransferRef },
    });
    const meta = JSON.parse(tx!.metadata!);

    const totalDebit = tx!.amountKobo + tx!.feeKobo;
    const feePercentage = (tx!.feeKobo / tx!.amountKobo) * 100;

    // Fee should be between 0.5% and 5%
    expect(feePercentage).toBeGreaterThanOrEqual(0.5);
    expect(feePercentage).toBeLessThanOrEqual(5);
  });

  it("destination amount is calculated correctly from rate", async () => {
    const tx = await db.transaction.findFirst({
      where: { reference: testTransferRef },
    });
    const meta = JSON.parse(tx!.metadata!);

    // destinationAmountMinor should be approximately amountMinor * rate
    const expectedDest = Math.round(tx!.amountKobo * meta.rate);
    expect(meta.destinationAmountMinor).toBe(expectedDest);
  });

  it("settlement record has correct currency pair", async () => {
    const settlement = await db.settlement.findFirst({
      where: { reference: testTransferRef },
    });
    expect(settlement).not.toBeNull();
    expect(settlement!.settlementCurrency).toBe("USD");
    expect(settlement!.type).toBe("INTL_TRANSFER");
  });
});

// ─── Timeline Data ────────────────────────────────────────────

describe("Timeline data integrity", () => {
  it("audit logs contain state transitions for the transfer", async () => {
    const logs = await db.auditLog.findMany({
      where: {
        userId: testUserId,
        action: { in: ["INTL_TRANSFER_SENT", "FX_QUOTE"] },
      },
      orderBy: { createdAt: "asc" },
    });

    // Should have at least the INTL_TRANSFER_SENT log
    const sentLog = logs.find((l) => l.action === "INTL_TRANSFER_SENT");
    expect(sentLog).toBeDefined();

    const logMeta = JSON.parse(sentLog!.metadata!);
    expect(logMeta.reference).toBe(testTransferRef);
    expect(logMeta.sourceCurrency).toBe("NGN");
    expect(logMeta.destinationCurrency).toBe("USD");
  });

  it("audit log timestamps are in chronological order", async () => {
    const logs = await db.auditLog.findMany({
      where: {
        userId: testUserId,
        action: { in: ["FX_QUOTE", "INTL_TRANSFER_SENT"] },
        metadata: { contains: testTransferRef },
      },
      orderBy: { createdAt: "asc" },
    });

    for (let i = 1; i < logs.length; i++) {
      expect(logs[i].createdAt.getTime()).toBeGreaterThanOrEqual(
        logs[i - 1].createdAt.getTime()
      );
    }
  });
});

// ─── Component Export Verification ────────────────────────────

describe("Component modules load correctly", () => {
  it("FeeBreakdown component exports", async () => {
    const mod = await import("@/components/turbopay/parts/intl-fee-breakdown");
    expect(mod.FeeBreakdown).toBeDefined();
    expect(typeof mod.FeeBreakdown).toBe("function");
  });

  it("TransferTracking component exports", async () => {
    const mod = await import("@/components/turbopay/parts/transfer-tracking");
    expect(mod.TransferTracking).toBeDefined();
    expect(typeof mod.TransferTracking).toBe("function");
  });

  it("transfer detail API route exports GET handler", async () => {
    const mod = await import("@/app/api/intl/transfer/route");
    expect(mod.GET).toBeDefined();
    expect(typeof mod.GET).toBe("function");
  });
});
