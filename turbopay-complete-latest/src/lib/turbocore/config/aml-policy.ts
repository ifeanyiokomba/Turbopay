/** Configurable AML policy — JSON document with hardcoded fallback. */
import { db } from "@/lib/db";
import { recordConfigVersion } from "@/lib/turbocore/config/versioning";

export interface AmlPolicyDocument {
  velocity?: { windowMin: number; maxDebits: number; severity: "LOW" | "MEDIUM" | "HIGH" };
  largeAmount?: { thresholdMinor: number; severity: "LOW" | "MEDIUM" | "HIGH" };
  rapidTransfer?: { windowMin: number; maxTransfers: number; severity: "LOW" | "MEDIUM" | "HIGH" };
  autoFreezeOnHigh?: boolean;
  strThresholdMinor?: number;
  dailyStrThresholdMinor?: number;
}

const DEFAULT_POLICY: AmlPolicyDocument = {
  velocity: { windowMin: 60, maxDebits: 10, severity: "HIGH" },
  largeAmount: { thresholdMinor: 1_000_000_00, severity: "MEDIUM" },
  rapidTransfer: { windowMin: 5, maxTransfers: 3, severity: "HIGH" },
  autoFreezeOnHigh: true,
  strThresholdMinor: 5_000_000_00,
  dailyStrThresholdMinor: 10_000_000_00,
};

class AmlPolicyService {
  async getActive(): Promise<AmlPolicyDocument> {
    const row = await db.amlPolicy.findFirst({ where: { active: true } });
    if (!row) return DEFAULT_POLICY;
    try { return JSON.parse(row.policy) as AmlPolicyDocument; } catch { return DEFAULT_POLICY; }
  }
  async list() { return db.amlPolicy.findMany({ orderBy: { name: "asc" } }); }
  async create(name: string, policy: AmlPolicyDocument, description?: string, actor?: { id: string; name: string }) {
    const created = await db.amlPolicy.create({ data: { name, description, policy: JSON.stringify(policy), active: false } });
    await recordConfigVersion("amlPolicy", created.id, "CREATE", null, created, undefined, actor);
    return created;
  }
  async activate(id: string, actor?: { id: string; name: string }) {
    await db.amlPolicy.updateMany({ where: { active: true }, data: { active: false } });
    const updated = await db.amlPolicy.update({ where: { id }, data: { active: true } });
    await recordConfigVersion("amlPolicy", id, "UPDATE", null, updated, "Policy activated", actor);
    return updated;
  }
}
export const amlPolicy = new AmlPolicyService();
export { DEFAULT_POLICY };
