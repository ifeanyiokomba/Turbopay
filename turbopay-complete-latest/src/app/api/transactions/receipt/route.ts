import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/turbopay/auth";

/**
 * GET /api/transactions/receipt?txId=xxx — Generate a user-facing transaction receipt.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const txId = req.nextUrl.searchParams.get("txId");

    if (!txId) {
      return NextResponse.json({ error: "txId parameter required" }, { status: 400 });
    }

    const tx = await db.transaction.findFirst({
      where: { id: txId, userId: user.id },
    });

    if (!tx) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    // Simple name masking: show first char + asterisks
    const maskName = (name: string) => {
      if (!name || name.length <= 1) return name;
      return name[0] + "*".repeat(Math.min(name.length - 1, 8));
    };

    const receipt = {
      receiptId: `RCP-${tx.reference}`,
      reference: tx.reference,
      type: tx.type,
      direction: tx.direction,
      status: tx.status,
      amount: tx.amountKobo / 100,
      fee: tx.feeKobo / 100,
      total: (tx.amountKobo + tx.feeKobo) / 100,
      currency: "NGN",
      counterparty: {
        name: tx.counterpartyName ? maskName(tx.counterpartyName) : undefined,
        account: tx.counterpartyAccount ? `****${tx.counterpartyAccount.slice(-4)}` : undefined,
        bank: tx.counterpartyBank,
      },
      description: tx.description,
      provider: tx.provider,
      createdAt: tx.createdAt.toISOString(),
      platform: {
        name: "Turbopay",
        tagline: "Digital Banking Made Simple",
      },
    };

    return NextResponse.json(receipt);
  } catch (e: any) {
    if (e?.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[Receipt Error]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
