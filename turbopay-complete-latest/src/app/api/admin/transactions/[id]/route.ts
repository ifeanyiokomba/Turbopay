import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";

/**
 * ADMIN — full transaction detail with ledger entries + user info.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission(Permissions.TX_VIEW_ALL);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { id } = await params;

  const tx = await db.transaction.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!tx) return errorJson("Transaction not found", 404, "NOT_FOUND");

  // All ledger entries referencing this transaction.
  const ledgerEntries = await db.ledgerEntry.findMany({
    where: { refId: tx.id },
    orderBy: { createdAt: "asc" },
  });

  // If this transaction is a reversal, fetch the original.
  let reversalOf: { id: string; reference: string; type: string; amountKobo: number; status: string; createdAt: Date } | null = null;
  if (tx.reversalOfId) {
    reversalOf = await db.transaction.findUnique({
      where: { id: tx.reversalOfId },
      select: { id: true, reference: true, type: true, amountKobo: true, status: true, createdAt: true },
    });
  }

  // And any reversals of this transaction.
  const reversals = await db.transaction.findMany({
    where: { reversalOfId: tx.id },
    select: { id: true, reference: true, amountKobo: true, status: true, createdAt: true },
  });

  return json({
    data: {
      transaction: {
        id: tx.id,
        reference: tx.reference,
        type: tx.type,
        direction: tx.direction,
        amountKobo: tx.amountKobo,
        feeKobo: tx.feeKobo,
        status: tx.status,
        counterpartyName: tx.counterpartyName,
        counterpartyAccount: tx.counterpartyAccount,
        counterpartyBank: tx.counterpartyBank,
        description: tx.description,
        provider: tx.provider,
        providerRef: tx.providerRef,
        reversalOfId: tx.reversalOfId,
        metadata: tx.metadata ? JSON.parse(tx.metadata) : null,
        createdAt: tx.createdAt.toISOString(),
        updatedAt: tx.updatedAt.toISOString(),
      },
      user: tx.user
        ? {
            id: tx.user.id,
            fullName: tx.user.fullName,
            email: tx.user.email,
            emailMasked: maskEmail(tx.user.email),
            phone: tx.user.phone,
            phoneMasked: tx.user.phone ? maskPhone(tx.user.phone) : null,
            kycTier: tx.user.kycTier,
            kycStatus: tx.user.kycStatus,
            status: tx.user.status,
          }
        : null,
      ledgerEntries: ledgerEntries.map((e) => ({
        id: e.id,
        walletId: e.walletId,
        entryType: e.entryType,
        amountKobo: e.amountKobo,
        currency: e.currency,
        refType: e.refType,
        refId: e.refId,
        pairId: e.pairId,
        balanceAfterKobo: e.balanceAfterKobo,
        description: e.description,
        immutable: e.immutable,
        createdAt: e.createdAt.toISOString(),
      })),
      reversalOf,
      reversals,
    },
  });
}
