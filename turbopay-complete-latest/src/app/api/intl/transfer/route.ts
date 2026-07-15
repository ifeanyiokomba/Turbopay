import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";

/**
 * GET /api/intl/transfer?id=xxx — get detailed transfer info with state history.
 */
export async function GET(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const reference = searchParams.get("reference");

  if (!id && !reference) return errorJson("Missing id or reference", 422);

  const where: Record<string, unknown> = { userId: user.id, provider: "intl-transfer" };
  if (id) where.id = id;
  if (reference) where.reference = reference;

  const tx = await db.transaction.findFirst({ where });
  if (!tx) return errorJson("Transfer not found", 404);

  // Parse metadata for fee breakdown and currency info
  const meta = tx.metadata ? JSON.parse(tx.metadata) : {};

  // Get state transition history from audit logs
  const stateTransitions = await db.auditLog.findMany({
    where: {
      userId: user.id,
      action: { in: ["TX_STATE_TRANSITION", "INTL_TRANSFER_SENT", "INTL_TRANSFER_FAILED"] },
      metadata: { contains: tx.reference },
    },
    orderBy: { createdAt: "asc" },
    select: { action: true, createdAt: true, metadata: true },
  });

  // Get settlement record
  const settlement = await db.settlement.findFirst({ where: { reference: tx.reference } });

  // Build timeline from state transitions
  const timeline = stateTransitions.map((log) => {
    const logMeta = log.metadata ? JSON.parse(log.metadata) : {};
    return {
      state: logMeta.to || log.action,
      timestamp: log.createdAt,
      label: getStateLabel(logMeta.to || log.action),
    };
  });

  // Add the initial creation event if not in timeline
  if (timeline.length === 0 || timeline[0]?.state !== "INITIATED") {
    timeline.unshift({
      state: "CREATED",
      timestamp: tx.createdAt,
      label: "Transfer Created",
    });
  }

  return json({
    data: {
      id: tx.id,
      reference: tx.reference,
      status: tx.status,
      state: tx.state,
      amountKobo: tx.amountKobo,
      feeKobo: tx.feeKobo,
      counterpartyName: tx.counterpartyName,
      counterpartyAccount: tx.counterpartyAccount,
      counterpartyBank: tx.counterpartyBank,
      description: tx.description,
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt,
      // Fee breakdown from metadata
      feeBreakdown: {
        sourceCurrency: meta.sourceCurrency,
        destinationCurrency: meta.destinationCurrency,
        exchangeRate: meta.rate,
        fxMarginBps: meta.fxMarginBps,
        platformFeeMinor: meta.feesMinor,
        destinationAmountMinor: meta.destinationAmountMinor,
      },
      // Settlement info
      settlement: settlement ? {
        status: settlement.status,
        settledAt: settlement.settledAt,
        settlementCurrency: settlement.settlementCurrency,
        settlementAmountMinor: settlement.settlementAmountMinor,
      } : null,
      // Timeline
      timeline,
    },
  });
}

function getStateLabel(state: string): string {
  const labels: Record<string, string> = {
    CREATED: "Transfer Created",
    INITIATED: "Initiated",
    PIN_VERIFIED: "PIN Verified",
    AML_CHECKED: "Compliance Check Passed",
    HOLD_POSTED: "Funds Held",
    PROVIDER_CALLED: "Sent to Provider",
    SETTLED: "Settled",
    REVERSED: "Reversed",
    TIMEOUT: "Timed Out",
    INTL_TRANSFER_SENT: "Provider Processing",
    INTL_TRANSFER_FAILED: "Provider Rejected",
  };
  return labels[state] || state;
}
