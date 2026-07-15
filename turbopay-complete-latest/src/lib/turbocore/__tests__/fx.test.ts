import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  fx,
  isPairSupported,
  SUPPORTED_PAIRS,
  pairKey,
  _clearFxConfigCacheForTests,
  seedDefaultFxConfigs,
  FxError,
} from "@/lib/turbocore/fx";

/**
 * FX Engine tests — verifies:
 *  - isPairSupported (supported + unsupported pairs)
 *  - getQuote applies the spread correctly (rate is lower than raw)
 *  - getQuote throws for unsupported pairs
 *  - getQuote computes destination amount + platform fee correctly
 *  - Snapshot caching (second call within TTL doesn't re-fetch from provider)
 *
 * Tests run against the real (SQLite dev) database.
 */

const TEST_PAIR = "USD→NGN";
const TEST_FROM = "USD";
const TEST_TO = "NGN";

beforeAll(async () => {
  // Ensure default FxConfig rows exist. Seed all 15 DEFAULT_CONFIGS
  // regardless of existing rows, so the test assertion is deterministic.
  const existing = await db.fxConfig.count();
  if (existing < 5) {
    // Clear stale rows and re-seed to guarantee a known state.
    await db.fxConfig.deleteMany({});
    await seedDefaultFxConfigs();
  }
});

beforeEach(async () => {
  // Clear the in-memory config cache so each test re-reads from the DB.
  _clearFxConfigCacheForTests();
  // Wipe snapshots for the test pair so each test starts fresh.
  await db.fxRateSnapshot.deleteMany({ where: { pair: TEST_PAIR } });
});

afterAll(async () => {
  await db.fxRateSnapshot.deleteMany({ where: { pair: TEST_PAIR } });
  await db.$disconnect();
});

describe("FX Engine — isPairSupported", () => {
  it("returns true for whitelisted pairs", () => {
    for (const pair of SUPPORTED_PAIRS) {
      const [from, to] = pair.split("→");
      expect(isPairSupported(from!, to!)).toBe(true);
    }
  });

  it("returns false for unsupported pairs", () => {
    expect(isPairSupported("NGN", "GHS")).toBe(false);
    expect(isPairSupported("KES", "NGN")).toBe(false);
    expect(isPairSupported("USD", "USD")).toBe(false);
    expect(isPairSupported("XYZ", "ABC")).toBe(false);
  });

  it("SUPPORTED_PAIRS contains all expected pairs", () => {
    expect(SUPPORTED_PAIRS.length).toBeGreaterThanOrEqual(5);
    expect(Array.from(SUPPORTED_PAIRS)).toEqual(
      expect.arrayContaining(["USD→NGN", "GBP→NGN", "EUR→NGN", "USD→GHS", "NGN→USD"]),
    );
  });

  it("pairKey composes the canonical arrow key", () => {
    expect(pairKey("USD", "NGN")).toBe("USD→NGN");
  });
});

describe("FX Engine — getQuote", () => {
  it("throws PAIR_NOT_SUPPORTED for unsupported pairs", async () => {
    try {
      await fx.getQuote("NGN", "GHS", 100_00, { skipAudit: true });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FxError);
      expect((e as FxError).code).toBe("PAIR_NOT_SUPPORTED");
    }
  });

  it("throws PAIR_DISABLED for disabled whitelisted pairs", async () => {
    // Snapshot the original config so we can restore it precisely.
    const original = await db.fxConfig.findUnique({ where: { pair: "USD→GHS" } });
    try {
      await fx.upsertConfig({ pair: "USD→GHS", enabled: false });
      _clearFxConfigCacheForTests();
      await expect(fx.getQuote("USD", "GHS", 100_00, { skipAudit: true })).rejects.toThrow(/disabled/);
    } finally {
      if (original) {
        await fx.upsertConfig({
          pair: "USD→GHS",
          enabled: original.enabled,
          spreadBps: original.spreadBps,
          platformFeeBps: original.platformFeeBps,
          minAmountMinor: original.minAmountMinor,
          maxAmountMinor: original.maxAmountMinor,
        });
      } else {
        await fx.deleteConfig("USD→GHS");
      }
      _clearFxConfigCacheForTests();
    }
  });

  it("applies the spread — quoted rate is lower than the raw mid-market rate", async () => {
    const quote = await fx.getQuote(TEST_FROM, TEST_TO, 100_00, { skipAudit: true });
    expect(quote.rawRate).toBeGreaterThan(0);
    expect(quote.rate).toBeGreaterThan(0);
    // Customer receives a worse (lower) rate than mid-market.
    expect(quote.rate).toBeLessThan(quote.rawRate);
    // spreadBps recorded correctly.
    expect(quote.spreadBps).toBeGreaterThan(0);
    // Verify the spread math: quotedRate = rawRate * (1 - spreadBps/10000)
    const expected = quote.rawRate * (1 - quote.spreadBps / 10_000);
    expect(quote.rate).toBeCloseTo(expected, 6);
  });

  it("computes destinationAmountMinor + platformFeeMinor correctly", async () => {
    const config = await fx.getSpread(TEST_PAIR);
    const amountMinor = 100_00; // $100.00
    const quote = await fx.getQuote(TEST_FROM, TEST_TO, amountMinor, { skipAudit: true });

    const expectedQuotedRate = quote.rawRate * (1 - config.spreadBps / 10_000);
    const expectedDestination = Math.round(amountMinor * expectedQuotedRate);
    const expectedFee = Math.round((amountMinor * config.platformFeeBps) / 10_000);

    expect(quote.destinationAmountMinor).toBe(expectedDestination);
    expect(quote.platformFeeMinor).toBe(expectedFee);
    expect(quote.from).toBe(TEST_FROM);
    expect(quote.to).toBe(TEST_TO);
    // rateId should be the snapshot id; expiresAt should be a future ISO date.
    expect(quote.rateId).toBeTruthy();
    expect(new Date(quote.expiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("throws AMOUNT_BELOW_MIN when amount is below the configured minimum", async () => {
    const original = await db.fxConfig.findUnique({ where: { pair: TEST_PAIR } });
    try {
      await fx.upsertConfig({ pair: TEST_PAIR, minAmountMinor: 500_00 });
      _clearFxConfigCacheForTests();
      await expect(fx.getQuote(TEST_FROM, TEST_TO, 100_00, { skipAudit: true })).rejects.toThrow(
        /below minimum/,
      );
    } finally {
      if (original) {
        await fx.upsertConfig({
          pair: TEST_PAIR,
          minAmountMinor: original.minAmountMinor,
          spreadBps: original.spreadBps,
          platformFeeBps: original.platformFeeBps,
          maxAmountMinor: original.maxAmountMinor,
          enabled: original.enabled,
        });
      }
      _clearFxConfigCacheForTests();
    }
  });

  it("throws AMOUNT_ABOVE_MAX when amount exceeds the configured maximum", async () => {
    const original = await db.fxConfig.findUnique({ where: { pair: TEST_PAIR } });
    try {
      await fx.upsertConfig({ pair: TEST_PAIR, maxAmountMinor: 1_000_00 }); // $10 cap
      _clearFxConfigCacheForTests();
      await expect(fx.getQuote(TEST_FROM, TEST_TO, 100_00_00, { skipAudit: true })).rejects.toThrow(
        /above maximum/,
      );
    } finally {
      if (original) {
        await fx.upsertConfig({
          pair: TEST_PAIR,
          minAmountMinor: original.minAmountMinor,
          spreadBps: original.spreadBps,
          platformFeeBps: original.platformFeeBps,
          maxAmountMinor: original.maxAmountMinor,
          enabled: original.enabled,
        });
      }
      _clearFxConfigCacheForTests();
    }
  });

  it("writes an FX_QUOTE audit log entry", async () => {
    const before = await db.auditLog.count({ where: { action: "FX_QUOTE" } });
    await fx.getQuote(TEST_FROM, TEST_TO, 100_00); // no skipAudit
    const after = await db.auditLog.count({ where: { action: "FX_QUOTE" } });
    // At least one new audit entry should be written. Use >= to handle
    // test isolation where other calls may also produce audit entries.
    expect(after).toBeGreaterThanOrEqual(before + 1);
  });
});

describe("FX Engine — snapshot caching", () => {
  it("does NOT re-fetch from the provider on a second call within TTL", async () => {
    // First call → should create exactly one new snapshot row.
    const beforeCount = await db.fxRateSnapshot.count({ where: { pair: TEST_PAIR } });
    await fx.getQuote(TEST_FROM, TEST_TO, 100_00, { skipAudit: true });
    const afterFirst = await db.fxRateSnapshot.count({ where: { pair: TEST_PAIR } });
    expect(afterFirst).toBe(beforeCount + 1);

    // Second call within TTL → should reuse the cached snapshot (no new row).
    await fx.getQuote(TEST_FROM, TEST_TO, 200_00, { skipAudit: true });
    const afterSecond = await db.fxRateSnapshot.count({ where: { pair: TEST_PAIR } });
    expect(afterSecond).toBe(afterFirst);
  });

  it("refreshSnapshot stores a new snapshot row with a future expiresAt", async () => {
    const before = await db.fxRateSnapshot.count({ where: { pair: TEST_PAIR } });
    const snap = await fx.refreshSnapshot(TEST_PAIR);
    expect(snap.rate).toBeGreaterThan(0);
    expect(snap.pair).toBe(TEST_PAIR);
    expect(snap.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const after = await db.fxRateSnapshot.count({ where: { pair: TEST_PAIR } });
    expect(after).toBe(before + 1);
  });

  it("getSnapshot returns the most-recent non-expired snapshot", async () => {
    await fx.refreshSnapshot(TEST_PAIR);
    const snap = await fx.getSnapshot(TEST_PAIR);
    expect(snap).not.toBeNull();
    expect(snap!.pair).toBe(TEST_PAIR);
    expect(snap!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("getSnapshot returns null when only expired snapshots exist", async () => {
    await db.fxRateSnapshot.create({
      data: {
        pair: TEST_PAIR,
        rate: 9999,
        providerRef: "expired-test",
        fetchedAt: new Date(Date.now() - 10 * 60 * 1000),
        expiresAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    });
    const snap = await fx.getSnapshot(TEST_PAIR);
    expect(snap).toBeNull();
  });
});

describe("FX Engine — admin surface", () => {
  it("listConfigs returns all supported pairs", async () => {
    const list = await fx.listConfigs();
    expect(list.length).toBeGreaterThanOrEqual(5);
    const pairs = list.map((c) => c.pair);
    expect(pairs).toContain("USD→NGN");
    expect(pairs).toContain("GBP→NGN");
    expect(pairs).toContain("EUR→NGN");
    expect(pairs).toContain("USD→GHS");
    expect(pairs).toContain("NGN→USD");
  });

  it("upsertConfig creates a new pair config + getSpread reads it back", async () => {
    const TEST_NEW_PAIR = "USD→KES";
    try {
      const cfg = await fx.upsertConfig({
        pair: TEST_NEW_PAIR,
        spreadBps: 250,
        platformFeeBps: 75,
        minAmountMinor: 0,
        maxAmountMinor: null,
        enabled: true,
      });
      expect(cfg.pair).toBe(TEST_NEW_PAIR);
      expect(cfg.spreadBps).toBe(250);
      expect(cfg.platformFeeBps).toBe(75);
      expect(cfg.enabled).toBe(true);
      _clearFxConfigCacheForTests();
      const fetched = await fx.getSpread(TEST_NEW_PAIR);
      expect(fetched.spreadBps).toBe(250);
      expect(fetched.platformFeeBps).toBe(75);
    } finally {
      await fx.deleteConfig(TEST_NEW_PAIR);
    }
  });

  it("deleteConfig removes a pair config (getSpread then throws)", async () => {
    const TEST_DEL_PAIR = "EUR→GHS";
    await fx.upsertConfig({ pair: TEST_DEL_PAIR, spreadBps: 100 });
    _clearFxConfigCacheForTests();
    // getSpread should now succeed.
    expect(await fx.getSpread(TEST_DEL_PAIR)).toBeTruthy();
    await fx.deleteConfig(TEST_DEL_PAIR);
    _clearFxConfigCacheForTests();
    await expect(fx.getSpread(TEST_DEL_PAIR)).rejects.toThrow(/not found/);
  });
});
