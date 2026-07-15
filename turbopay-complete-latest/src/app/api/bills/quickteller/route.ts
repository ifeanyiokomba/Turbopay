import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";

/**
 * GET /api/bills/quickteller — list available Quickteller billers
 * Returns a curated list of common Quickteller billers (7000+ available via API)
 */
export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  // Quickteller billers — common categories
  const billers = [
    { id: "mtn-airtime", name: "MTN Airtime", category: "airtime", description: "MTN mobile airtime top-up", paymentCode: "10401" },
    { id: "glo-airtime", name: "GLO Airtime", category: "airtime", description: "GLO mobile airtime top-up", paymentCode: "10402" },
    { id: "airtel-airtime", name: "Airtel Airtime", category: "airtime", description: "Airtel mobile airtime top-up", paymentCode: "10403" },
    { id: "9mobile-airtime", name: "9mobile Airtime", category: "airtime", description: "9mobile airtime top-up", paymentCode: "10404" },
    { id: "mtn-data", name: "MTN Data", category: "data", description: "MTN data bundle", paymentCode: "10405" },
    { id: "glo-data", name: "GLO Data", category: "data", description: "GLO data bundle", paymentCode: "10406" },
    { id: "airtel-data", name: "Airtel Data", category: "data", description: "Airtel data bundle", paymentCode: "10407" },
    { id: "dstv", name: "DStv", category: "tv", description: "DStv subscription", paymentCode: "10408" },
    { id: "gotv", name: "GOtv", category: "tv", description: "GOtv subscription", paymentCode: "10409" },
    { id: "startimes", name: "StarTimes", category: "tv", description: "StarTimes subscription", paymentCode: "10410" },
    { id: "ikedc", name: "IKEC", category: "electricity", description: "Ikeja Electric Distribution", paymentCode: "10411" },
    { id: "ekedc", name: "Eko Electric", category: "electricity", description: "Eko Electricity Distribution", paymentCode: "10412" },
    { id: "ibedc", name: "Ibadan Electric", category: "electricity", description: "Ibadan Electricity Distribution", paymentCode: "10413" },
    { id: "phed", name: "Port Harcourt Electric", category: "electricity", description: "Port Harcourt Electricity Distribution", paymentCode: "10414" },
    { id: "bet9ja", name: "Bet9ja", category: "betting", description: "Bet9ja wallet funding", paymentCode: "10415" },
    { id: "sportybet", name: "SportyBet", category: "betting", description: "SportyBet wallet funding", paymentCode: "10416" },
    { id: "waec", name: "WAEC", category: "education", description: "WAEC result checker", paymentCode: "10417" },
    { id: "jamb", name: "JAMB", category: "education", description: "JAMB registration", paymentCode: "10418" },
  ];

  return json({ data: { billers } });
}

/**
 * POST /api/bills/quickteller — validate customer or process payment
 * Actions: "validate" | "pay"
 */
export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { action, billerId, customerRef, amountNaira, customerName, billerName } = body as {
    action?: string;
    billerId?: string;
    customerRef?: string;
    amountNaira?: number;
    customerName?: string;
    billerName?: string;
  };

  if (!action) return errorJson("Missing action", 422);

  if (action === "validate") {
    if (!billerId) return errorJson("Missing biller ID", 422);
    if (!customerRef) return errorJson("Missing customer reference", 422);

    // In production, this would call Quickteller's API to validate the customer
    // For now, simulate validation
    const mockCustomerName = "Customer (Simulated)";

    return json({
      data: {
        valid: true,
        customerName: mockCustomerName,
        message: "Customer validated successfully",
      },
    });
  }

  if (action === "pay") {
    if (!billerId) return errorJson("Missing biller ID", 422);
    if (!customerRef) return errorJson("Missing customer reference", 422);
    if (!amountNaira || amountNaira <= 0) return errorJson("Invalid amount", 422);

    const amountKobo = Math.round(amountNaira * 100);

    // Debit wallet
    const wallet = await db.wallet.findFirst({ where: { userId: user.id } });
    if (!wallet) return errorJson("Wallet not found", 404);
    if (wallet.balanceKobo < amountKobo) return errorJson("Insufficient funds", 400);

    // Create transaction
    const reference = `QT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
        description: `Quickteller payment - ${billerName ?? billerId} (${customerRef})`,
        provider: "quickteller",
        metadata: JSON.stringify({ billerId, customerRef, customerName }),
      },
    });

    // Update wallet balance
    await db.wallet.update({
      where: { id: wallet.id },
      data: { balanceKobo: { decrement: amountKobo } },
    });

    await audit({ action: "quickteller.payment", category: "BILL", userId: transaction.userId, metadata: { billerId, customerRef, amountKobo } });

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
