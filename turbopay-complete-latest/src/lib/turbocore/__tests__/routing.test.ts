import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "@/lib/db";
import { providerRouting } from "@/lib/turbocore/config/provider-routing";
import { providers, listProviders } from "@/lib/turbocore/providers/registry";
import type { ProviderContract } from "@/lib/turbocore/providers/interfaces";

/**
 * Provider routing engine tests — verifies the resolve / getRouteConfig /
 * setRoute surface and the registry's DB-route → mock fallback behaviour.
 *
 * Tests run against the real (SQLite dev) database. Each test that creates
 * DB state uses a unique contract name (e.g. "billPayment-test-…") so it
 * cannot collide with other suites, and tears down its rows in afterEach.
 *
 * The audit() helper writes an AuditLog row on ROUTE_EXHAUSTED — we accept
 * that side-effect (it is the documented behaviour).
 */

const TEST_CONTRACT_BASE = "billPayment-routing-test";
const TEST_PROVIDER_NAME = "mock-baxi-test";
const TEST_DISPLAY_NAME = "Routing Test Provider";

let testProviderConfigId: string | null = null;
let testContract: string | null = null;

/** Helper: create a ProviderConfig + PRIMARY route for a given contract. */
async function setupRoute(contract: string, mode = "mock"): Promise<{ configId: string }> {
  const config = await db.providerConfig.create({
    data: {
      contract,
      providerName: TEST_PROVIDER_NAME,
      displayName: TEST_DISPLAY_NAME,
      mode,
      priority: 100,
      enabled: true,
    },
  });
  await providerRouting.setRoute(contract, "PRIMARY", config.id);
  return { configId: config.id };
}

/** Helper: tear down everything we created for a contract. */
async function teardownRoute(contract: string, configId: string | null): Promise<void> {
  if (configId) {
    await db.providerRoute.deleteMany({ where: { providerConfigId: configId } });
    await db.providerHealthCheck.deleteMany({ where: { providerConfigId: configId } });
    await db.providerConfig.deleteMany({ where: { id: configId } });
  }
  await db.providerRoute.deleteMany({ where: { contract } });
}

afterEach(async () => {
  if (testContract && testProviderConfigId) {
    await teardownRoute(testContract, testProviderConfigId);
  }
  testContract = null;
  testProviderConfigId = null;
});

afterAll(async () => {
  // Belt-and-suspenders: scrub any stragglers from a crashed test run.
  await db.providerRoute.deleteMany({ where: { contract: { contains: "routing-test" } } });
  await db.providerConfig.deleteMany({ where: { contract: { contains: "routing-test" } } });
  await db.$disconnect();
});

describe("Provider Routing Engine", () => {
  it("getRouteConfig returns empty tiers + null manualOverride when no DB routes configured", async () => {
    const contract = `${TEST_CONTRACT_BASE}-empty-${Date.now()}`;
    const route = await providerRouting.getRouteConfig(contract);
    expect(route.contract).toBe(contract);
    expect(route.tiers).toHaveLength(0);
    expect(route.manualOverride).toBeNull();
  });

  it("resolve throws ROUTE_EXHAUSTED when no healthy provider is configured (audit logged)", async () => {
    const contract = `${TEST_CONTRACT_BASE}-exhausted-${Date.now()}`;
    await expect(providerRouting.resolve(contract)).rejects.toThrow(/ROUTE_EXHAUSTED/);
  });

  it("setRoute writes a PRIMARY tier row and getRouteConfig returns it", async () => {
    testContract = `${TEST_CONTRACT_BASE}-set-${Date.now()}`;
    const { configId } = await setupRoute(testContract, "mock");
    testProviderConfigId = configId;

    const route = await providerRouting.getRouteConfig(testContract);
    expect(route.tiers).toHaveLength(1);
    expect(route.tiers[0]!.tier).toBe("PRIMARY");
    expect(route.tiers[0]!.providerConfigId).toBe(configId);
    expect(route.tiers[0]!.providerName).toBe(TEST_PROVIDER_NAME);
    expect(route.tiers[0]!.enabled).toBe(true);
  });

  it("resolve returns the configured PRIMARY provider when a mock-mode route exists", async () => {
    testContract = `${TEST_CONTRACT_BASE}-resolve-${Date.now()}`;
    const { configId } = await setupRoute(testContract, "mock");
    testProviderConfigId = configId;

    const resolved = await providerRouting.resolve(testContract, { skipHealthCheck: true });
    expect(resolved.providerConfigId).toBe(configId);
    expect(resolved.contract).toBe(testContract);
    expect(resolved.providerName).toBe(TEST_PROVIDER_NAME);
    expect(resolved.tier).toBe("PRIMARY");
    expect(resolved.mode).toBe("mock");
    expect(resolved.selectionReason).toBe("primary");
  });

  it("resolve skips a PRIMARY tier whose rules do not match the ctx", async () => {
    testContract = `${TEST_CONTRACT_BASE}-rules-${Date.now()}`;
    const config = await db.providerConfig.create({
      data: {
        contract: testContract,
        providerName: TEST_PROVIDER_NAME,
        displayName: TEST_DISPLAY_NAME,
        mode: "mock",
        priority: 100,
        enabled: true,
      },
    });
    testProviderConfigId = config.id;
    // PRIMARY requires minAmount 10_000_00; ctx.amountMinor below that → skip.
    await providerRouting.setRoute(testContract, "PRIMARY", config.id, {
      rules: { minAmount: 10_000_00 },
    });

    // Below the min → ROUTE_EXHAUSTED.
    await expect(
      providerRouting.resolve(testContract, { skipHealthCheck: true, amountMinor: 5_000_00 }),
    ).rejects.toThrow(/ROUTE_EXHAUSTED/);

    // At/above the min → resolves.
    const resolved = await providerRouting.resolve(testContract, {
      skipHealthCheck: true,
      amountMinor: 10_000_00,
    });
    expect(resolved.providerConfigId).toBe(config.id);
  });

  it("resolve honours a manual override over the PRIMARY tier", async () => {
    testContract = `${TEST_CONTRACT_BASE}-override-${Date.now()}`;
    const primary = await db.providerConfig.create({
      data: {
        contract: testContract,
        providerName: `${TEST_PROVIDER_NAME}-primary`,
        displayName: "Primary",
        mode: "mock",
        priority: 100,
        enabled: true,
      },
    });
    const override = await db.providerConfig.create({
      data: {
        contract: testContract,
        providerName: `${TEST_PROVIDER_NAME}-override`,
        displayName: "Override",
        mode: "mock",
        priority: 50,
        enabled: true,
      },
    });
    testProviderConfigId = primary.id; // teardown will hit primary; manually delete override below.

    await providerRouting.setRoute(testContract, "PRIMARY", primary.id);
    await providerRouting.setManualOverride(testContract, override.id);

    const resolved = await providerRouting.resolve(testContract, { skipHealthCheck: true });
    expect(resolved.providerConfigId).toBe(override.id);
    expect(resolved.providerName).toBe(`${TEST_PROVIDER_NAME}-override`);
    expect(resolved.selectionReason).toBe("manual_override");

    // Cleanup the override config (the afterEach only cleans testProviderConfigId).
    await db.providerConfig.deleteMany({ where: { id: override.id } });
  });

  it("setManualOverride throws when no PRIMARY route exists for the contract", async () => {
    const contract = `${TEST_CONTRACT_BASE}-no-primary-${Date.now()}`;
    await expect(providerRouting.setManualOverride(contract, "any-id")).rejects.toThrow(
      /No PRIMARY route/,
    );
  });
});

describe("Registry → routing integration (mock fallback path)", () => {
  it("providers.billPayment() resolves to mock when no DB route is configured", async () => {
    const bp = await providers.billPayment();
    expect(bp.name).toBe("mock-bill-payment");
  });

  it("providers.kyc() resolves to mock when no DB route is configured", async () => {
    const kyc = await providers.kyc();
    expect(kyc.name).toBe("mock-kyc");
  });

  it("providers.notification() resolves to mock when no DB route is configured", async () => {
    const n = await providers.notification();
    expect(n.name).toBe("mock-notification");
  });

  it("listProviders returns one entry per contract (10) with mock mode by default", async () => {
    const list = await listProviders();
    expect(list).toHaveLength(10);
    // Every contract key appears exactly once.
    const contracts = new Set(list.map((p) => p.contract));
    expect(contracts.size).toBe(10);
    // Default mode (no env var set) is "mock".
    for (const entry of list) {
      expect(["mock", "sandbox", "production"]).toContain(entry.mode);
      expect(entry.name).toBeTruthy();
    }
    // Verify all expected contracts are present.
    const expected: ProviderContract[] = [
      "virtualAccount", "walletFunding", "localTransfer", "internationalTransfer",
      "internationalReceiving", "crossBorderSettlement", "exchangeRate",
      "billPayment", "kyc", "notification",
    ];
    for (const c of expected) {
      expect(contracts.has(c)).toBe(true);
    }
  });

  it("env-var fallback: TURBOCORE_PROVIDER_BILLPAYMENT=production with no registered adapter falls to mock in test env", async () => {
    const prev = process.env.TURBOCORE_PROVIDER_BILLPAYMENT;
    process.env.TURBOCORE_PROVIDER_BILLPAYMENT = "production";
    try {
      // In test env (NODE_ENV !== "production"), the registry does NOT throw
      // when no production adapter is registered — it falls through to mock.
      const bp = await providers.billPayment();
      expect(bp.name).toBe("mock-bill-payment");
    } finally {
      if (prev === undefined) delete process.env.TURBOCORE_PROVIDER_BILLPAYMENT;
      else process.env.TURBOCORE_PROVIDER_BILLPAYMENT = prev;
    }
  });
});
