/** Config versioning — every change recorded with redacted sensitive fields. */
import { db } from "@/lib/db";

export interface ConfigVersionActor { id: string; name: string; }

const REDACT_KEYS = ["credentialsEnc", "secretEnc", "passwordHash", "transactionPinHash"];

function redactSensitive(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitive);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT_KEYS.includes(key)) { out[key] = "[REDACTED]"; }
    else if (typeof value === "object") { out[key] = redactSensitive(value); }
    else { out[key] = value; }
  }
  return out;
}

export async function recordConfigVersion(
  entityType: string, entityId: string, action: "CREATE" | "UPDATE" | "DELETE",
  before: unknown, after: unknown, reason?: string, actor?: ConfigVersionActor
): Promise<void> {
  const last = await db.configVersion.findFirst({ where: { entityType, entityId }, orderBy: { version: "desc" }, select: { version: true } });
  await db.configVersion.create({
    data: {
      entityType, entityId, action,
      before: before ? JSON.stringify(redactSensitive(before)) : null,
      after: after ? JSON.stringify(redactSensitive(after)) : null,
      reason: reason ?? null,
      changedBy: actor?.id ?? null, changedByName: actor?.name ?? null,
      version: (last?.version ?? 0) + 1,
    },
  });
}

export async function getConfigHistory(entityType: string, entityId: string, limit = 50) {
  return db.configVersion.findMany({ where: { entityType, entityId }, orderBy: { version: "desc" }, take: limit });
}
export async function getRecentConfigChanges(limit = 50) {
  return db.configVersion.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
