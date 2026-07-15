import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { reverseEntry, LedgerError } from "@/lib/turbopay/ledger";
import { createTransactionRecord } from "@/lib/turbopay/wallet";
import * as crypto from "node:crypto";

const DISPUTE_TYPES = ["FAILED_TRANSFER", "INCORRECT_DEBIT", "CARD_DISPUTE", "BILL_PAYMENT_ISSUE", "UNAUTHORIZED_TRANSACTION", "DUPLICATE_CHARGE", "OTHER"] as const;
const SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 168 };

/** Parse the dispute.metadata JSON column safely (returns {} on null/invalid). */
function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

class DisputeService {
  private async generateDisputeNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await db.dispute.count({ where: { createdAt: { gte: new Date(`${year}-01-01`) } } });
    return `DSP-${year}-${String(count + 1).padStart(6, "0")}`;
  }

  async create(userId: string, input: { transactionId?: string; type: string; subject: string; description: string; amountDisputedKobo?: number; priority?: string }) {
    const priority = input.priority ?? "MEDIUM";
    const slaHours = SLA_HOURS[priority] ?? 72;

    // Retry on unique constraint violation (concurrent count-then-create race)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const disputeNumber = await this.generateDisputeNumber();
        const dispute = await db.dispute.create({
          data: {
            disputeNumber, userId, transactionId: input.transactionId, type: input.type,
            subject: input.subject, description: input.description,
            amountDisputedKobo: input.amountDisputedKobo, priority, status: "OPEN",
            slaDueAt: new Date(Date.now() + slaHours * 60 * 60 * 1000),
          },
        });
        await db.disputeMessage.create({ data: { disputeId: dispute.id, authorId: userId, authorName: "Customer", authorRole: "CUSTOMER", message: input.description } });
        await audit({ userId, action: "DISPUTE_CREATED", category: "ADMIN", severity: "WARN", metadata: { disputeNumber, type: input.type } });
        return dispute;
      } catch (e: any) {
        if (e.code === "P2002" && attempt < 2) continue; // unique constraint violation, retry
        throw e;
      }
    }
    // Fallback: random suffix guarantees uniqueness
    const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
    const disputeNumber = `DSP-${new Date().getFullYear()}-${rand}`;
    const dispute = await db.dispute.create({
      data: {
        disputeNumber, userId, transactionId: input.transactionId, type: input.type,
        subject: input.subject, description: input.description,
        amountDisputedKobo: input.amountDisputedKobo, priority, status: "OPEN",
        slaDueAt: new Date(Date.now() + slaHours * 60 * 60 * 1000),
      },
    });
    await db.disputeMessage.create({ data: { disputeId: dispute.id, authorId: userId, authorName: "Customer", authorRole: "CUSTOMER", message: input.description } });
    await audit({ userId, action: "DISPUTE_CREATED", category: "ADMIN", severity: "WARN", metadata: { disputeNumber, type: input.type } });
    return dispute;
  }

  async addMessage(disputeId: string, input: { authorId?: string; authorName: string; authorRole: string; message: string; isInternal?: boolean }) {
    return db.disputeMessage.create({ data: { disputeId, ...input, isInternal: input.isInternal ?? false } });
  }

  async getDispute(disputeId: string) {
    return db.dispute.findUnique({ where: { id: disputeId }, include: { messages: { orderBy: { createdAt: "asc" } }, attachments: true } });
  }

  async listUserDisputes(userId: string) {
    return db.dispute.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  }

  async listAll(filters: { status?: string; priority?: string; type?: string; assignedTo?: string; q?: string }, page = 1, limit = 50) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.priority) where.priority = filters.priority;
    if (filters.type) where.type = filters.type;
    if (filters.assignedTo) where.assignedTo = filters.assignedTo;
    if (filters.q) { where.OR = [{ disputeNumber: { contains: filters.q } }, { subject: { contains: filters.q } }, { description: { contains: filters.q } }]; }
    const [items, total] = await Promise.all([
      db.dispute.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: (page - 1) * limit, include: { user: { select: { fullName: true, email: true } } } }),
      db.dispute.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /**
   * Update a dispute — status, priority, assignee, resolution.
   *
   * AUTO-REFUND: when `status` transitions INTO `RESOLVED_FAVOUR_USER` (i.e.
   * the previous status was NOT already `RESOLVED_FAVOUR_USER`) AND no refund
   * has previously been recorded in `dispute.metadata.refundedAt`, the service
   * reverses every original ledger leg tied to the disputed transaction ON THE
   * DISPUTING USER'S WALLET, creates a REVERSAL Transaction record, and marks
   * the original transaction `REVERSED`.
   *
   * Only the disputing user's wallet legs are reversed — we never claw back
   * from a third-party recipient (that requires a separate legal clawback
   * flow). For TRANSFER_OUT disputes, this means the sender is refunded but
   * the recipient keeps their credit.
   *
   * IDEMPOTENCY: `metadata.refundedAt` is the source of truth. Once set, no
   * subsequent update — even one that re-triggers the FAVOUR_USER transition —
   * will refund again. This is also safe against `OPEN → FAVOUR_USER → CLOSED`
   * (CLOSED does not re-trigger) and against `OPEN → FAVOUR_PLATFORM →
   * FAVOUR_USER` (the metadata flag is still clear, so a single refund fires).
   */
  async update(disputeId: string, input: { status?: string; priority?: string; assignedTo?: string; resolution?: string; resolutionNotes?: string }, actor?: { id: string; name: string }) {
    const existing = await db.dispute.findUnique({ where: { id: disputeId } });
    if (!existing) throw new Error("Dispute not found");

    const data: Record<string, unknown> = {};
    if (input.status !== undefined) {
      data.status = input.status;
      if (["RESOLVED_FAVOUR_USER", "RESOLVED_FAVOUR_PLATFORM", "CLOSED"].includes(input.status)) {
        data.resolvedAt = new Date();
        if (input.status === "CLOSED") data.closedAt = new Date();
      }
    }
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.assignedTo !== undefined) data.assignedTo = input.assignedTo;
    if (input.resolution !== undefined) data.resolution = input.resolution;
    if (input.resolutionNotes !== undefined) data.resolutionNotes = input.resolutionNotes;

    // ─── AUTO-REFUND (idempotent) ────────────────────────────────────────
    const isTransitioningToFavourUser =
      input.status === "RESOLVED_FAVOUR_USER" && existing.status !== "RESOLVED_FAVOUR_USER";
    const existingMeta = parseMetadata(existing.metadata);
    const alreadyRefunded = Boolean(existingMeta.refundedAt);

    let refundResult: {
      reversalEntryIds: string[];
      reversalTransactionId: string;
      amountKobo: number;
    } | null = null;

    if (isTransitioningToFavourUser && !alreadyRefunded) {
      refundResult = await this.processAutoRefund(existing, actor);
      if (refundResult) {
        // Persist the idempotency flag + audit refs onto the dispute metadata.
        const newMeta: Record<string, unknown> = {
          ...existingMeta,
          refundedAt: new Date().toISOString(),
          refundReversalEntryIds: refundResult.reversalEntryIds,
          refundReversalTransactionId: refundResult.reversalTransactionId,
          refundAmountKobo: refundResult.amountKobo,
        };
        data.metadata = JSON.stringify(newMeta);
      }
    }

    const updated = await db.dispute.update({ where: { id: disputeId }, data });

    if (actor) {
      await audit({
        userId: actor.id,
        action: "DISPUTE_UPDATED",
        category: "ADMIN",
        metadata: { disputeId, disputeNumber: existing.disputeNumber, fields: Object.keys(data) },
      });
    }

    if (refundResult) {
      await audit({
        userId: existing.userId,
        action: "DISPUTE_RESOLVED_REFUND",
        category: "WALLET",
        severity: "WARN",
        metadata: {
          disputeId,
          disputeNumber: existing.disputeNumber,
          transactionId: existing.transactionId,
          reversalTransactionId: refundResult.reversalTransactionId,
          reversalEntryIds: refundResult.reversalEntryIds,
          amountKobo: refundResult.amountKobo,
          actorId: actor?.id,
          actorName: actor?.name,
        },
      });
    }

    return updated;
  }

  /**
   * Refund the disputing user by reversing every original ledger leg tied to
   * the disputed transaction on the user's wallet. Returns null if there is
   * no linked transaction or no eligible ledger legs to reverse (e.g. the
   * dispute was filed without a transaction reference, or the transaction is
   * already REVERSED).
   */
  private async processAutoRefund(
    dispute: { id: string; disputeNumber: string; userId: string; transactionId: string | null },
    actor?: { id: string; name: string },
  ): Promise<{ reversalEntryIds: string[]; reversalTransactionId: string; amountKobo: number } | null> {
    if (!dispute.transactionId) return null;

    const tx = await db.transaction.findUnique({ where: { id: dispute.transactionId } });
    if (!tx) return null;
    if (tx.type === "REVERSAL") return null; // can't reverse a reversal
    if (tx.status === "REVERSED" || tx.status === "FAILED") return null; // nothing to refund

    // Only reverse legs on the disputing user's wallet. This is the safe
    // scope: refund the user who filed the dispute, never claw back from a
    // third-party recipient. For TRANSFER_OUT this means only the sender's
    // DEBIT leg is reversed (refunding the sender) — the recipient's CREDIT
    // is left untouched.
    const ledgerEntries = await db.ledgerEntry.findMany({
      where: { refId: tx.id, walletId: tx.walletId, refType: { not: "REVERSAL" } },
      orderBy: { createdAt: "asc" },
    });
    if (ledgerEntries.length === 0) return null;

    const reversalEntryIds: string[] = [];
    for (const leg of ledgerEntries) {
      try {
        const result = await reverseEntry(leg.id, {
          description: `Dispute ${dispute.disputeNumber} resolved in user's favour — auto-refund`,
          refId: tx.id,
        });
        reversalEntryIds.push(result.reversalEntryId);
      } catch (e) {
        if (e instanceof LedgerError) {
          // WALLET_FROZEN / INSUFFICIENT_FUNDS / etc — abort the refund but
          // still let the dispute status update proceed. Audit will capture
          // the partial state via the absence of refund metadata.
          await audit({
            userId: dispute.userId,
            action: "DISPUTE_REFUND_FAILED",
            category: "WALLET",
            severity: "ERROR",
            metadata: {
              disputeId: dispute.id,
              disputeNumber: dispute.disputeNumber,
              transactionId: tx.id,
              ledgerEntryId: leg.id,
              code: e.code,
              message: e.message,
              actorId: actor?.id,
            },
          });
          return null;
        }
        throw e;
      }
    }

    // Create the REVERSAL Transaction record (opposite direction of original).
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
      description: `Dispute ${dispute.disputeNumber} refund — reversal of ${tx.reference}`,
      provider: tx.provider,
      metadata: {
        disputeId: dispute.id,
        disputeNumber: dispute.disputeNumber,
        reversalOfId: tx.id,
        reversalOfReference: tx.reference,
        actorId: actor?.id,
        actorName: actor?.name,
        reversalEntryIds,
      },
    });

    // Back-link + mark the original transaction as REVERSED.
    await db.transaction.update({ where: { id: reversalTx.id }, data: { reversalOfId: tx.id } });
    await db.transaction.update({ where: { id: tx.id }, data: { status: "REVERSED" } });

    return {
      reversalEntryIds,
      reversalTransactionId: reversalTx.id,
      amountKobo: tx.amountKobo,
    };
  }

  async checkSlaBreaches() {
    const now = new Date();
    return db.dispute.findMany({ where: { status: { in: ["OPEN", "UNDER_REVIEW", "EVIDENCE_REQUIRED"] }, slaDueAt: { lt: now } }, select: { id: true, disputeNumber: true, userId: true, slaDueAt: true, priority: true } });
  }
}

export const disputes = new DisputeService();
export { DISPUTE_TYPES };
