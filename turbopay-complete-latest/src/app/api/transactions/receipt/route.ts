import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/turbopay/auth";
import { transactionService } from "@/lib/turbopay/services/transaction.service";
import { ServiceError } from "@/lib/turbopay/services/types";

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

    const receipt = await transactionService.receipt(user.id, txId);
    return NextResponse.json(receipt);
  } catch (e: any) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e?.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
