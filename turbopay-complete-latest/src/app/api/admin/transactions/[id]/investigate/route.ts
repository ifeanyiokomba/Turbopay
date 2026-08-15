/**
 * ADMIN — Transaction Investigation Timeline
 * =============================================
 *
 * GET /api/admin/transactions/[id]/investigate
 *
 * Returns the complete lifecycle of a transaction for operator investigation:
 *   - Transaction details
 *   - All state changes with timestamps
 *   - Provider calls and responses
 *   - Webhook history
 *   - Ledger entries (debit/credit)
 *   - Reconciliation status
 *   - Timeline of events
 *
 * This is one of the highest-value operational features for incident
 * investigation. An operator can take a transaction reference and understand
 * exactly what happened, when, and why.
 */

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/turbocore/rbac";
import { Permissions } from "@/lib/turbocore/rbac";
import { db } from "@/lib/db";
import { logger } from "@/lib/turbocore/logger";

// ─── Response Types ───────────────────────────────────────────

interface TimelineEvent {
  timestamp: Date;
  type: string;
  source: string;
  title: string;
  description: string;
  metadata?: Record<string, unknown>;
  severity: "info" | "success" | "warning" | "error";
}

interface InvestigationResponse {
  transaction: {
    id: string;
    reference: string;
    userId: string;
    type: string;
    direction: string;
    amountKobo: number;
    feeKobo: number;
    status: string;
    state: string | null;
    provider: string | null;
    providerRef: string | null;
    counterpartyName: string | null;
    counterpartyAccount: string | null;
    counterpartyBank: string | null;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  timeline: TimelineEvent[];
  ledgerEntries: Array<{
    id: string;
    entryType: string;
    amountKobo: number;
    refType: string;
    balanceAfterKobo: number;
    description: string | null;
    createdAt: Date;
  }>;
  webhookEvents: Array<{
    id: string;
    provider: string;
    providerRef: string;
    status: string;
    error: string | null;
    receivedAt: Date;
    processedAt: Date | null;
  }>;
  reconciliation: {
    walletReconciled: boolean;
    cachedBalance: number;
    ledgerBalance: number;
    driftCorrected: boolean;
  } | null;
  summary: {
    totalEvents: number;
    firstEvent: Date | null;
    lastEvent: Date | null;
    durationMs: number | null;
    issuesDetected: string[];
  };
}

// ─── Route Handler ────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePermission(Permissions.ADMIN_VIEW);

    const { id } = await params;

    // Fetch the transaction
    const transaction = await db.transaction.findFirst({
      where: {
        OR: [{ id }, { reference: id }],
      },
    });

    if (!transaction) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }

    // Build the timeline from all available sources
    const timeline: TimelineEvent[] = [];

    // 1. Transaction creation event
    timeline.push({
      timestamp: transaction.createdAt,
      type: "transaction.created",
      source: "system",
      title: "Transaction created",
      description: `${transaction.type} ${transaction.direction} of ${(transaction.amountKobo / 100).toFixed(2)} NGN`,
      severity: "info",
      metadata: {
        type: transaction.type,
        direction: transaction.direction,
        amountKobo: transaction.amountKobo,
        feeKobo: transaction.feeKobo,
      },
    });

    // 2. Fetch TransactionEvent records (lifecycle state changes)
    const transactionEvents = await db.transactionEvent.findMany({
      where: { transactionId: transaction.id },
      orderBy: { createdAt: "asc" },
    });

    for (const event of transactionEvents) {
      timeline.push({
        timestamp: event.createdAt,
        type: event.eventType,
        source: event.eventSource ?? "system",
        title: formatEventType(event.eventType),
        description: event.metadata ? JSON.parse(event.metadata).description ?? event.eventType : event.eventType,
        metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
        severity: getEventSeverity(event.eventType),
      });
    }

    // 3. State transition events from the transaction record itself
    if (transaction.state) {
      const stateEvents = parseStateTransitions(transaction.state, transaction.createdAt);
      timeline.push(...stateEvents);
    }

    // 4. Fetch ledger entries for this transaction
    const ledgerEntries = await db.ledgerEntry.findMany({
      where: {
        OR: [
          { refId: transaction.id },
          { refType: "TRANSFORM", refId: transaction.reference },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    // Also check by walletId + reference pattern
    if (ledgerEntries.length === 0) {
      const walletEntries = await db.ledgerEntry.findMany({
        where: {
          walletId: transaction.walletId,
          OR: [
            { refId: transaction.id },
            { refId: transaction.reference },
          ],
        },
        orderBy: { createdAt: "asc" },
      });
      ledgerEntries.push(...walletEntries);
    }

    for (const entry of ledgerEntries) {
      timeline.push({
        timestamp: entry.createdAt,
        type: `ledger.${entry.entryType.toLowerCase()}`,
        source: "ledger",
        title: `Ledger ${entry.entryType.toLowerCase()}: ${(entry.amountKobo / 100).toFixed(2)} NGN`,
        description: `${entry.refType} — ${entry.entryType} of ${(entry.amountKobo / 100).toFixed(2)} NGN. Balance after: ${(entry.balanceAfterKobo / 100).toFixed(2)} NGN`,
        severity: entry.entryType === "DEBIT" ? "warning" : "success",
        metadata: {
          ledgerEntryId: entry.id,
          entryType: entry.entryType,
          amountKobo: entry.amountKobo,
          refType: entry.refType,
          balanceAfterKobo: entry.balanceAfterKobo,
        },
      });
    }

    // 5. Fetch webhook events
    const webhookEvents = transaction.providerRef
      ? await db.webhookEvent.findMany({
          where: { providerRef: transaction.providerRef },
          orderBy: { receivedAt: "asc" },
        })
      : [];

    for (const webhook of webhookEvents) {
      timeline.push({
        timestamp: webhook.receivedAt,
        type: "webhook.received",
        source: "webhook",
        title: `Webhook received from ${webhook.provider}`,
        description: `Provider ${webhook.provider} webhook: ${webhook.status}${webhook.error ? ` — ${webhook.error}` : ""}`,
        severity: webhook.status === "PROCESSED" ? "success" : webhook.status === "FAILED" ? "error" : "info",
        metadata: {
          webhookEventId: webhook.id,
          provider: webhook.provider,
          status: webhook.status,
        },
      });
    }

    // 6. Provider events from TransactionEvent
    const providerEvents = transactionEvents.filter(
      (e) => e.eventType.startsWith("provider.")
    );
    for (const event of providerEvents) {
      const parsed = event.metadata ? JSON.parse(event.metadata) : {};
      timeline.push({
        timestamp: event.createdAt,
        type: event.eventType,
        source: "provider",
        title: formatEventType(event.eventType),
        description: parsed.description ?? event.eventType,
        severity: event.eventType.includes("failed") ? "error" : "info",
        metadata: parsed,
      });
    }

    // 7. Sort timeline by timestamp
    timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // 8. Check wallet reconciliation
    let reconciliation = null;
    try {
      const wallet = await db.wallet.findUnique({
        where: { id: transaction.walletId },
      });
      if (wallet) {
        const { getLedgerBalance } = await import("@/lib/turbopay/ledger");
        const ledgerBalance = await getLedgerBalance(transaction.walletId);
        const drift = wallet.balanceKobo - ledgerBalance;
        reconciliation = {
          walletReconciled: drift === 0,
          cachedBalance: wallet.balanceKobo,
          ledgerBalance,
          driftCorrected: false,
        };
      }
    } catch {
      // Non-critical — don't fail the investigation
    }

    // 9. Detect issues
    const issuesDetected: string[] = [];

    if (transaction.status === "PENDING" && isStuck(transaction)) {
      const stuckMinutes = (Date.now() - transaction.createdAt.getTime()) / (60 * 1000);
      issuesDetected.push(`Transaction is stuck in PENDING for ${Math.round(stuckMinutes)} minutes`);
    }

    if (transaction.status === "FAILED") {
      const failureEvents = timeline.filter((e) => e.severity === "error");
      if (failureEvents.length > 0) {
        issuesDetected.push(`Failed: ${failureEvents[failureEvents.length - 1].title}`);
      }
    }

    if (reconciliation && !reconciliation.walletReconciled) {
      issuesDetected.push(`Wallet balance drift detected: ${reconciliation.cachedBalance} vs ${reconciliation.ledgerBalance}`);
    }

    if (webhookEvents.length === 0 && transaction.status === "PENDING" && transaction.provider) {
      issuesDetected.push("No webhook received — provider may not have processed the transaction");
    }

    // 10. Build summary
    const firstEvent = timeline.length > 0 ? timeline[0].timestamp : null;
    const lastEvent = timeline.length > 0 ? timeline[timeline.length - 1].timestamp : null;
    const durationMs = firstEvent && lastEvent ? lastEvent.getTime() - firstEvent.getTime() : null;

    const response: InvestigationResponse = {
      transaction: {
        id: transaction.id,
        reference: transaction.reference,
        userId: transaction.userId,
        type: transaction.type,
        direction: transaction.direction,
        amountKobo: transaction.amountKobo,
        feeKobo: transaction.feeKobo,
        status: transaction.status,
        state: transaction.state,
        provider: transaction.provider,
        providerRef: transaction.providerRef,
        counterpartyName: transaction.counterpartyName,
        counterpartyAccount: transaction.counterpartyAccount,
        counterpartyBank: transaction.counterpartyBank,
        description: transaction.description,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
      },
      timeline,
      ledgerEntries: ledgerEntries.map((e) => ({
        id: e.id,
        entryType: e.entryType,
        amountKobo: e.amountKobo,
        refType: e.refType,
        balanceAfterKobo: e.balanceAfterKobo,
        description: e.description,
        createdAt: e.createdAt,
      })),
      webhookEvents: webhookEvents.map((w) => ({
        id: w.id,
        provider: w.provider,
        providerRef: w.providerRef,
        status: w.status,
        error: w.error,
        receivedAt: w.receivedAt,
        processedAt: w.processedAt,
      })),
      reconciliation,
      summary: {
        totalEvents: timeline.length,
        firstEvent,
        lastEvent,
        durationMs,
        issuesDetected,
      },
    };

    logger.info("transaction.investigate", {
      transactionId: transaction.id,
      reference: transaction.reference,
      timelineEvents: timeline.length,
      issuesDetected: issuesDetected.length,
    });

    return NextResponse.json({ data: response });
  } catch (error: any) {
    if (error?.code === "FORBIDDEN" || error?.status === 403) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    logger.error("transaction.investigate_error", { error: error?.message });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function isStuck(transaction: { status: string; createdAt: Date }): boolean {
  if (transaction.status !== "PENDING" && transaction.status !== "PROCESSING") return false;
  const stuckMinutes = (Date.now() - transaction.createdAt.getTime()) / (60 * 1000);
  return stuckMinutes > 15;
}

function formatEventType(eventType: string): string {
  const parts = eventType.split(".");
  if (parts.length < 2) return eventType;
  const action = parts.slice(1).join(" ").replace(/_/g, " ");
  return `${parts[0]} ${action}`;
}

function getEventSeverity(eventType: string): "info" | "success" | "warning" | "error" {
  if (eventType.includes("success") || eventType.includes("completed") || eventType.includes("matched")) return "success";
  if (eventType.includes("failed") || eventType.includes("error") || eventType.includes("rejected")) return "error";
  if (eventType.includes("warning") || eventType.includes("mismatch") || eventType.includes("timeout")) return "warning";
  return "info";
}

function parseStateTransitions(state: string, createdAt: Date): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const states = state.split(",").map((s) => s.trim()).filter(Boolean);

  states.forEach((stateName, index) => {
    // Estimate timestamps: spread evenly across the transaction lifetime
    const estimatedTime = new Date(
      createdAt.getTime() + (index / Math.max(states.length - 1, 1)) * (Date.now() - createdAt.getTime())
    );

    events.push({
      timestamp: estimatedTime,
      type: `state.${stateName.toLowerCase()}`,
      source: "state_machine",
      title: `State: ${stateName}`,
      description: `Transaction entered state ${stateName}`,
      severity: stateName === "REVERSED" ? "warning" : stateName === "TIMEOUT" ? "error" : "info",
    });
  });

  return events;
}
