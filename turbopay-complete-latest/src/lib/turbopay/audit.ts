import { db } from "@/lib/db";
import { logger } from "@/lib/turbocore/logger";

/**
 * AUDIT LAYER — append-only audit trail for compliance (NDPR) & operations.
 */
export interface AuditInput {
  userId?: string | null;
  action: string;
  category: "AUTH" | "WALLET" | "TRANSFER" | "BILL" | "KYC" | "AML" | "ADMIN" | "WEBHOOK" | "FX";
  severity?: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        category: input.category,
        severity: input.severity ?? "INFO",
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
  } catch (e) {
    // Audit must never break the request flow.
    logger.error("audit.write_failed", { error: e instanceof Error ? e.message : String(e) });
  }
}
