import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { reverseEntry, LedgerError } from "@/lib/turbopay/ledger";
import { createTransactionRecord } from "@/lib/turbopay/wallet";
import { z } from "zod";

/**
 * ADMIN — reverse a transaction (high-trust, requires TX_REVERSE permission).
 *
 * Posts an opposing ledger leg for every original ledger entry tied to this
 * transaction, creates a REVERSAL Transaction record, and marks the original
 * as REVERSED. Idempotency: refuses to reverse a REVERSAL or an already-
 * REVERSED transaction.
 */
const schema = z.object({
  reason: z.string().min(2).max(500),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requirePermission(Permissions.TX_REVERSE);
  } catch (e: any) {
    return errorJson(e.message ?? "Unauthorized", e.status ?? 401, e.code ?? "UNAUTHORIZED");
  }
  // Suspended / frozen accounts cannot perform admin actions.
  if (actor.status !== "ACTIVE") {
    return errorJson("Your account is not active.", 403, "ACCOUNT_NOT_ACTIVE");
  }
  const { id } = await params;

  let body;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid body", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  }
  const { reason } = parsed.data;

  const tx = await db.transaction.findUnique({ where: { id } });
  if (!tx) return errorJson("Transaction not found", 404, "NOT_FOUND");
  if (tx.type === "REVERSAL") {
    return errorJson("Cannot reverse a reversal transaction", 409, "CANNOT_REVERSE_REVERSAL");
  }
  if (tx.status === "REVERSED") {
    return errorJson("Transaction is already reversed", 409, "ALREADY_REVERSED");
  }
  if (tx.status === "FAILED") {
    return errorJson("Cannot reverse a FAILED transaction (no funds were moved)", 409, "NOTHING_TO_REVERSE");
  }

  // Collect all original ledger entries for this transaction (skip any that are
  // themselves REVERSAL legs — those should never exist on a non-reversed tx,
  // but we guard anyway).
  const ledgerEntries = await db.ledgerEntry.findMany({
    where: { refId: tx.id, refType: { not: "REVERSAL" } },
    orderBy: { createdAt: "asc" },
  });
  if (ledgerEntries.length === 0) {
    return errorJson("No ledger entries found for this transaction", 409, "NO_LEDGER_ENTRIES");
  }

  // Reverse every original leg. Use a fresh transaction per reversal to keep
  // behavior consistent with the existing reverseEntry() helper (which opens
  // its own $transaction when no tx is passed).
  const reversalEntryIds: string[] = [];
  try {
    for (const leg of ledgerEntries) {
      const result = await reverseEntry(leg.id, {
        description: `Admin reversal by ${actor.fullName}: ${reason}`,
        refId: tx.id,
      });
      reversalEntryIds.push(result.reversalEntryId);
    }
  } catch (e: any) {
    if (e instanceof LedgerError) {
      return errorJson(e.message, 409, e.code);
    }
    throw e;
  }

  // Create the REVERSAL Transaction record (opposite direction).
  const reversalTx = await createTransactionRecord({
    userId: tx.userId,
    walletId: tx.walletId,
    type: "REVERSAL",
    direction: tx.direction === "CREDIT" ? "DEBIT" : "CREDIT",
    amountKobo: tx.amountKobo,
    feeKobo: 0,
    status: "SUCCESS",
    counterpartyName: tx.counterpartyName,
    counterpartyAccount: tx.counterpartyAccount,
    counterpartyBank: tx.counterpartyBank,
    description: `Reversal of ${tx.reference}: ${reason}`,
    provider: tx.provider,
    metadata: {
      reversalOfId: tx.id,
      reversalOfReference: tx.reference,
      reason,
      adminId: actor.id,
      adminName: actor.fullName,
      reversalEntryIds,
    },
  });

  // Back-link the reversal transaction id onto itself + mark the original.
  await db.transaction.update({
    where: { id: reversalTx.id },
    data: { reversalOfId: tx.id },
  });
  await db.transaction.update({
    where: { id: tx.id },
    data: { status: "REVERSED" },
  });

  await audit({
    userId: actor.id,
    action: "TRANSACTION_REVERSED",
    category: "TRANSFER",
    severity: "CRITICAL",
    metadata: {
      transactionId: tx.id,
      transactionReference: tx.reference,
      reversalTransactionId: reversalTx.id,
      reversalReference: reversalTx.reference,
      amountKobo: tx.amountKobo,
      reason,
      adminId: actor.id,
      adminName: actor.fullName,
      reversalEntryIds,
    },
  });

  return json({
    data: {
      originalTransactionId: tx.id,
      originalReference: tx.reference,
      originalStatus: "REVERSED",
      reversalTransactionId: reversalTx.id,
      reversalReference: reversalTx.reference,
      reversalEntryIds,
    },
  });
}
