import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { configuration } from "@/lib/turbocore/configuration";

/**
 * Configuration Service Tests
 *
 * Verifies audit-trail diffing, version history, and rollback capabilities.
 */

let testFeeId: string;
let testFlagId: string;

beforeAll(async () => {
  // Create test fee config
  const fee = await db.feeConfig.create({
    data: {
      product: "turbopay",
      category: "TEST_CATEGORY",
      type: "FLAT",
      value: 100,
      minFeeMinor: 50,
      maxFeeMinor: 500,
      active: true,
    },
  });
  testFeeId = fee.id;

  // Create test feature flag
  const flag = await db.featureFlag.create({
    data: {
      key: "test-feature",
      description: "Test feature flag",
      enabled: false,
      rollout: 0,
    },
  });
  testFlagId = flag.id;
});

afterAll(async () => {
  await db.configVersion.deleteMany({ where: { entityId: { in: [testFeeId, testFlagId] } } });
  await db.feeConfig.deleteMany({ where: { id: testFeeId } });
  await db.featureFlag.deleteMany({ where: { id: testFlagId } });
  await db.$disconnect();
});

describe("Configuration Service", () => {
  describe("recordChange", () => {
    it("records a configuration change with version tracking", async () => {
      const record = await configuration.recordChange({
        entityType: "fee",
        entityId: testFeeId,
        action: "CREATE",
        after: { value: 100, type: "FLAT" },
        reason: "Initial fee setup",
        changedBy: "admin-1",
        changedByName: "Admin User",
      });

      expect(record).toHaveProperty("id");
      expect(record.entityType).toBe("fee");
      expect(record.entityId).toBe(testFeeId);
      expect(record.action).toBe("CREATE");
      expect(record.version).toBe(1);
      expect(record.reason).toBe("Initial fee setup");
      expect(record.changedBy).toBe("admin-1");
    });

    it("increments version number on subsequent changes", async () => {
      const record1 = await configuration.recordChange({
        entityType: "fee",
        entityId: testFeeId,
        action: "UPDATE",
        before: { value: 100 },
        after: { value: 200 },
        reason: "Increase fee",
        changedBy: "admin-1",
        changedByName: "Admin User",
      });

      const record2 = await configuration.recordChange({
        entityType: "fee",
        entityId: testFeeId,
        action: "UPDATE",
        before: { value: 200 },
        after: { value: 150 },
        reason: "Reduce fee",
        changedBy: "admin-2",
        changedByName: "Admin User 2",
      });

      // Version numbers should be sequential (relative check)
      expect(record2.version).toBe(record1.version + 1);
    });
  });

  describe("getVersionHistory", () => {
    it("returns version history for an entity", async () => {
      const history = await configuration.getVersionHistory("fee", testFeeId);
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].entityType).toBe("fee");
      expect(history[0].entityId).toBe(testFeeId);
    });

    it("returns empty array for non-existent entity", async () => {
      const history = await configuration.getVersionHistory("fee", "non-existent-id");
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBe(0);
    });
  });

  describe("getRecentChanges", () => {
    it("returns recent changes across all entities", async () => {
      const changes = await configuration.getRecentChanges(10);
      expect(Array.isArray(changes)).toBe(true);
      expect(changes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("exportConfiguration", () => {
    it("exports all configuration as a snapshot", async () => {
      const snapshot = await configuration.exportConfiguration();

      expect(snapshot).toHaveProperty("fees");
      expect(snapshot).toHaveProperty("fxConfigs");
      expect(snapshot).toHaveProperty("featureFlags");
      expect(snapshot).toHaveProperty("providerConfigs");
      expect(snapshot).toHaveProperty("amlPolicies");
      expect(snapshot).toHaveProperty("kycLimits");
      expect(snapshot).toHaveProperty("serviceFlags");
      expect(snapshot).toHaveProperty("exportedAt");

      expect(Array.isArray(snapshot.fees)).toBe(true);
      expect(Array.isArray(snapshot.featureFlags)).toBe(true);
    });
  });

  describe("getVersionDiff", () => {
    it("returns diff between two versions", async () => {
      const diff = await configuration.getVersionDiff("fee", testFeeId, 1, 2);
      expect(diff).toHaveProperty("entity");
      expect(diff).toHaveProperty("from");
      expect(diff).toHaveProperty("to");
      expect(diff).toHaveProperty("changes");
      expect(diff.entity.entityType).toBe("fee");
      expect(diff.entity.entityId).toBe(testFeeId);
    });
  });
});
