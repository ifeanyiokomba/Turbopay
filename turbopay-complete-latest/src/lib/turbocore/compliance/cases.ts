/** Compliance Case Service — STR workflow, review queues, case management. */
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { recordConfigVersion } from "@/lib/turbocore/config/versioning";

class ComplianceCaseService {
  async openCase(userId: string, type: string, severity: string, description: string, amlFlagId?: string | null, actor?: { id: string; name: string }) {
    const created = await db.complianceCase.create({ data: { userId, type, severity, description, amlFlagId: amlFlagId ?? null, status: "OPEN" } });
    await audit({ userId: actor?.id, action: "COMPLIANCE_CASE_OPENED", category: "AML", severity: severity === "HIGH" ? "CRITICAL" : "WARN", metadata: { caseId: created.id, userId, type, severity } });
    return created;
  }

  async updateCase(id: string, input: { status?: string; notes?: string; assignedTo?: string }, actor?: { id: string; name: string }) {
    const existing = await db.complianceCase.findUnique({ where: { id } });
    if (!existing) throw new Error("Case not found");
    const data: Record<string, unknown> = {};
    if (input.status !== undefined) data.status = input.status;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.assignedTo !== undefined) data.assignedTo = input.assignedTo;
    if (input.status === "CLOSED") data.resolvedAt = new Date();
    const updated = await db.complianceCase.update({ where: { id }, data });
    await recordConfigVersion("complianceCase", id, "UPDATE", existing, updated, undefined, actor);
    await audit({ userId: actor?.id, action: "COMPLIANCE_CASE_UPDATED", category: "AML", severity: "INFO", metadata: { caseId: id, status: input.status } });
    return updated;
  }

  async closeCase(id: string, resolution: string, actor?: { id: string; name: string }) {
    return this.updateCase(id, { status: "CLOSED", notes: resolution }, actor);
  }

  async listCases(filter: { status?: string; type?: string; assignedTo?: string }, page = 1, limit = 50) {
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.type) where.type = filter.type;
    if (filter.assignedTo) where.assignedTo = filter.assignedTo;
    const [items, total] = await Promise.all([
      db.complianceCase.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: (page - 1) * limit }),
      db.complianceCase.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getCase(id: string) { return db.complianceCase.findUnique({ where: { id } }); }

  /**
   * File a Suspicious Transaction Report (STR).
   * Creates a compliance case with type "STR" and status "FILED".
   */
  async fileSTR(input: {
    userId: string;
    transactionId?: string;
    amountKobo: number;
    description: string;
    suspiciousIndicators: string[];
    filedBy: string;
    filedByName: string;
  }): Promise<{ caseId: string; reference: string }> {
    const caseRecord = await db.complianceCase.create({
      data: {
        userId: input.userId,
        type: "STR",
        severity: "HIGH",
        status: "FILED",
        description: `STR Filed: ${input.description}\n\nSuspicious Indicators:\n${input.suspiciousIndicators.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}\n\nAmount: ₦${(input.amountKobo / 100).toLocaleString()}\nTransaction: ${input.transactionId ?? "N/A"}`,
        assignedTo: input.filedBy,
      },
    });

    await audit({
      userId: input.filedBy,
      action: "STR_FILED",
      category: "AML",
      severity: "CRITICAL",
      metadata: {
        caseId: caseRecord.id,
        userId: input.userId,
        transactionId: input.transactionId,
        amountKobo: input.amountKobo,
        indicators: input.suspiciousIndicators,
      },
    });

    return { caseId: caseRecord.id, reference: caseRecord.id };
  }

  /**
   * Screen a user against sanctions lists (interface for future integration).
   * Returns match results for admin review.
   */
  async screenSanctions(input: {
    userId: string;
    fullName: string;
    dateOfBirth?: string;
    nationality?: string;
  }): Promise<{
    screened: boolean;
    matches: { list: string; matchScore: number; details: string }[];
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
  }> {
    // In production, this would call an external sanctions screening API
    // (e.g., ComplyAdvantage, Refinitiv World-Check, Dow Jones).
    // For now, return a placeholder that indicates the interface is ready.

    await audit({
      userId: input.userId,
      action: "SANCTIONS_SCREENING",
      category: "AML",
      severity: "INFO",
      metadata: { fullName: input.fullName, nationality: input.nationality },
    });

    return {
      screened: true,
      matches: [], // No matches (placeholder — real integration would check against lists)
      riskLevel: "LOW",
    };
  }

  /**
   * Get compliance summary for the dashboard.
   */
  async getSummary(): Promise<{
    openCases: number;
    filedSTRs: number;
    pendingReviews: number;
    resolvedThisMonth: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [openCases, filedSTRs, pendingReviews, resolvedThisMonth, allCases] = await Promise.all([
      db.complianceCase.count({ where: { status: "OPEN" } }),
      db.complianceCase.count({ where: { type: "STR", status: "FILED" } }),
      db.complianceCase.count({ where: { status: "UNDER_REVIEW" } }),
      db.complianceCase.count({ where: { status: "CLOSED", resolvedAt: { gte: monthStart } } }),
      db.complianceCase.findMany({
        select: { type: true, severity: true },
        where: { createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const c of allCases) {
      byType[c.type] = (byType[c.type] ?? 0) + 1;
      bySeverity[c.severity] = (bySeverity[c.severity] ?? 0) + 1;
    }

    return { openCases, filedSTRs, pendingReviews, resolvedThisMonth, byType, bySeverity };
  }
}

export const complianceCases = new ComplianceCaseService();
