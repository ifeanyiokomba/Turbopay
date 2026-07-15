import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";

/**
 * GET /api/bills/remita — list available Remita billers
 * Returns a curated list of common Remita billers (government payments, etc.)
 */
export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  // Remita billers — common government and utility payments
  const billers = [
    { id: "jamb", name: "JAMB", category: "education", description: "Joint Admissions and Matriculation Board" },
    { id: "waec", name: "WAEC", category: "education", description: "West African Examinations Council" },
    { id: "nimc", name: "NIMC", category: "identity", description: "National Identity Management Commission" },
    { id: "firs", name: "FIRS", category: "tax", description: "Federal Inland Revenue Service" },
    { id: "lasg", name: "Lagos State Government", category: "government", description: "Lagos State government payments" },
    { id: "customs", name: "Nigeria Customs", category: "government", description: "Nigeria Customs Service" },
    { id: "pencom", name: "PenCom", category: "pension", description: "National Pension Commission" },
    { id: "nhis", name: "NHIS", category: "health", description: "National Health Insurance Scheme" },
  ];

  return json({ data: { billers } });
}

/**
 * POST /api/bills/remita — validate RRR or process payment
 * Actions: "validate" | "pay"
 */
export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { action, rrr, amountNaira, billerName } = body as {
    action?: string;
    rrr?: string;
    amountNaira?: number;
    billerName?: string;
  };

  if (!action) return errorJson("Missing action", 422);

  if (action === "validate") {
    if (!rrr) return errorJson("Missing RRR", 422);

    // In production, this would call Remita's API to validate the RRR
    // For now, simulate validation
    const mockCustomerName = "John Doe (Simulated)";
    const mockAmount = 5000;

    return json({
      data: {
        valid: true,
        customerName: mockCustomerName,
        amount: mockAmount,
        message: "RRR validated successfully",
      },
    });
  }

  if (action === "pay") {
    if (!rrr) return errorJson("Missing RRR", 422);
    if (!amountNaira || amountNaira <= 0) return errorJson("Invalid amount", 422);

    const amountKobo = Math.round(amountNaira * 100);

    // Debit wallet
    const wallet = await db.wallet.findFirst({ where: { userId: user.id } });
    if (!wallet) return errorJson("Wallet not found", 404);
    if (wallet.balanceKobo < amountKobo) return errorJson("Insufficient funds", 400);

    // Create transaction
    const reference = `REMITA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const transaction = await db.transaction.create({
      data: {
        userId: user.id,
        walletId: wallet.id,
        type: "BILL_ELECTRICITY",
        direction: "DEBIT",
        amountKobo,
        feeKobo: 0,
        status: "SUCCESS",
        reference,
        description: `Remita payment - ${billerName ?? "Bill"} (RRR: ${rrr})`,
        provider: "remita",
        metadata: JSON.stringify({ rrr, billerName }),
      },
    });

    // Update wallet balance
    await db.wallet.update({
      where: { id: wallet.id },
      data: { balanceKobo: { decrement: amountKobo } },
    });

    await audit({ action: "remita.payment", category: "BILL", userId: transaction.userId, metadata: { rrr, amountKobo, billerName } });

    return json({
      data: {
        reference,
        amountKobo,
        newBalanceKobo: wallet.balanceKobo - amountKobo,
      },
    });
  }

  return errorJson("Invalid action", 422);
}
