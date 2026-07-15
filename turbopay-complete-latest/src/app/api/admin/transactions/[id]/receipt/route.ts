import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";
import { formatNaira } from "@/lib/turbopay/money";

/**
 * ADMIN — generate a receipt JSON for a transaction.
 * Returns a structured receipt payload suitable for rendering to PDF/HTML.
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

  const receipt = {
    receiptId: `RCP-${tx.reference}`,
    reference: tx.reference,
    type: tx.type,
    direction: tx.direction,
    status: tx.status,
    amountKobo: tx.amountKobo,
    amountDisplay: formatNaira(tx.amountKobo),
    feeKobo: tx.feeKobo,
    feeDisplay: formatNaira(tx.feeKobo),
    totalKobo: tx.amountKobo + tx.feeKobo,
    totalDisplay: formatNaira(tx.amountKobo + tx.feeKobo),
    currency: "NGN",
    counterparty: {
      name: tx.counterpartyName,
      account: tx.counterpartyAccount,
      bank: tx.counterpartyBank,
    },
    description: tx.description,
    provider: tx.provider,
    providerRef: tx.providerRef,
    reversalOfId: tx.reversalOfId,
    customer: tx.user
      ? {
          id: tx.user.id,
          fullName: tx.user.fullName,
          emailMasked: maskEmail(tx.user.email),
          phoneMasked: tx.user.phone ? maskPhone(tx.user.phone) : null,
        }
      : null,
    issuedAt: new Date().toISOString(),
    transactionDate: tx.createdAt.toISOString(),
    metadata: tx.metadata ? JSON.parse(tx.metadata) : null,
    issuer: {
      name: "Turbopay MFB",
      address: "Lagos, Nigeria",
      supportEmail: "support@turbopay.com",
    },
  };

  return json({ data: receipt });
}
