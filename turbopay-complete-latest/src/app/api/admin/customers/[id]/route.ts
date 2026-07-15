import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";

/**
 * ADMIN — full customer profile.
 * Includes: user (masked PII by default; full PII requires ADMIN_VIEW_PII),
 * wallet, recent txs, KYC, AML flags, compliance cases, support notes,
 * recent activity (audit log).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requirePermission(Permissions.ADMIN_VIEW);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  // Check if the actor has the PII permission (separate from ADMIN_VIEW).
  let hasPiiPermission = false;
  try {
    await requirePermission(Permissions.ADMIN_VIEW_PII);
    hasPiiPermission = true;
  } catch {
    // No PII permission — return masked values only.
  }

  const { id } = await params;

  const user = await db.user.findUnique({
    where: { id },
    include: {
      wallet: true,
      virtualAccounts: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!user) return errorJson("Customer not found", 404, "NOT_FOUND");

  const [recentTxs, kycRecords, amlFlags, complianceCases, supportNotes, recentActivity] = await Promise.all([
    db.transaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.kycVerification.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
    }),
    db.amlFlag.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.complianceCase.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.supportNote.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.auditLog.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return json({
    data: {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: hasPiiPermission ? user.email : maskEmail(user.email),
        emailMasked: maskEmail(user.email),
        phone: hasPiiPermission ? user.phone : (user.phone ? maskPhone(user.phone) : null),
        phoneMasked: user.phone ? maskPhone(user.phone) : null,
        kycTier: user.kycTier,
        kycStatus: user.kycStatus,
        status: user.status,
        role: user.role,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        avatarUrl: user.avatarUrl,
        bvnMasked: user.bvn ? "***********" : null, // bvn is encrypted at rest; show only presence
        ninMasked: user.nin ? "***********" : null,
        pinSetAt: user.pinSetAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      wallet: user.wallet
        ? {
            id: user.wallet.id,
            balanceKobo: user.wallet.balanceKobo,
            currency: user.wallet.currency,
            status: user.wallet.status,
            version: user.wallet.version,
            createdAt: user.wallet.createdAt.toISOString(),
            updatedAt: user.wallet.updatedAt.toISOString(),
          }
        : null,
      virtualAccounts: user.virtualAccounts.map((v) => ({
        id: v.id,
        accountNumber: v.accountNumber,
        accountName: v.accountName,
        bankName: v.bankName,
        bankCode: v.bankCode,
        provider: v.provider,
        status: v.status,
        createdAt: v.createdAt.toISOString(),
      })),
      recentTransactions: recentTxs.map((t) => ({
        id: t.id,
        reference: t.reference,
        type: t.type,
        direction: t.direction,
        amountKobo: t.amountKobo,
        feeKobo: t.feeKobo,
        status: t.status,
        counterpartyName: t.counterpartyName,
        description: t.description,
        provider: t.provider,
        createdAt: t.createdAt.toISOString(),
      })),
      kycRecords: kycRecords.map((k) => ({
        id: k.id,
        tier: k.tier,
        status: k.status,
        provider: k.provider,
        ninMasked: k.nin ? "***********" : null,
        bvnMasked: k.bvn ? "***********" : null,
        phoneMasked: k.phone ? k.phone ? maskPhone(k.phone) : null : null,
        emailMasked: k.email ? maskEmail(k.email) : null,
        firstName: k.firstName,
        lastName: k.lastName,
        verifiedAt: k.verifiedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
      amlFlags: amlFlags.map((f) => ({
        id: f.id,
        rule: f.rule,
        severity: f.severity,
        description: f.description,
        resolved: f.resolved,
        resolvedAt: f.resolvedAt?.toISOString() ?? null,
        metadata: f.metadata ? JSON.parse(f.metadata) : null,
        createdAt: f.createdAt.toISOString(),
      })),
      complianceCases: complianceCases.map((c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        severity: c.severity,
        description: c.description,
        notes: c.notes,
        assignedTo: c.assignedTo,
        resolvedAt: c.resolvedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
      supportNotes: supportNotes.map((n) => ({
        id: n.id,
        authorId: n.authorId,
        authorName: n.authorName,
        note: n.note,
        pinned: n.pinned,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })),
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        action: a.action,
        category: a.category,
        severity: a.severity,
        metadata: a.metadata ? JSON.parse(a.metadata) : null,
        createdAt: a.createdAt.toISOString(),
      })),
    },
  });
}
