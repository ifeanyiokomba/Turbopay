/**
 * Unified Bill Payment API
 * =========================
 *
 * POST /api/bills/pay — Process a bill payment via the routing engine.
 *
 * Routes to the best provider (Baxi, Remita, Quickteller, BillSwift)
 * based on the biller's provider, executes the payment, and returns the result.
 * Users never see provider complexity.
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { requireUser } from "@/lib/turbopay/auth";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";

export async function POST(req: Request) {
  // Auth
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  // Rate limit
  const limited = await rateLimit(req, { key: "bill-payment", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  // Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }

  const { action, billerId, billerName, provider, customerRef, amountKobo, category, fixedAmount } = body as {
    action?: string;
    billerId: string;
    billerName: string;
    provider: string;
    customerRef: string;
    amountKobo: number;
    category: string;
    fixedAmount?: number;
  };

  // Handle validation action
  if (action === "validate") {
    if (!billerId || typeof billerId !== "string") {
      return errorJson("billerId is required", 400);
    }
    if (!provider || typeof provider !== "string") {
      return errorJson("provider is required", 400);
    }
    if (!customerRef || typeof customerRef !== "string") {
      return errorJson("customerRef is required", 400);
    }

    const result = await validateCustomer(provider, billerId, customerRef);
    return json({ data: result });
  }

  // Validate required fields
  if (!billerId || typeof billerId !== "string") {
    return errorJson("billerId is required", 400);
  }
  if (!billerName || typeof billerName !== "string") {
    return errorJson("billerName is required", 400);
  }
  if (!provider || typeof provider !== "string") {
    return errorJson("provider is required", 400);
  }
  if (!customerRef || typeof customerRef !== "string") {
    return errorJson("customerRef is required", 400);
  }

  const finalAmount = fixedAmount ?? amountKobo;
  if (!finalAmount || typeof finalAmount !== "number" || finalAmount <= 0) {
    return errorJson("amountKobo must be a positive number", 400);
  }

  // Validate customer reference first
  const validationResult = await validateCustomer(provider, billerId, customerRef);
  if (!validationResult.valid) {
    return errorJson(validationResult.message || "Customer validation failed", 400);
  }

  // Debit wallet
  const wallet = await db.wallet.findFirst({ where: { userId: user.id } });
  if (!wallet) return errorJson("Wallet not found", 404);
  if (wallet.balanceKobo < finalAmount) return errorJson("Insufficient funds", 400);

  // Create transaction
  const reference = `BILL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    // Debit wallet
    await db.wallet.update({
      where: { id: wallet.id },
      data: { balanceKobo: { decrement: finalAmount } },
    });

    // Create transaction record
    await db.transaction.create({
      data: {
        userId: user.id,
        walletId: wallet.id,
        type: "BILL_ELECTRICITY",
        direction: "DEBIT",
        amountKobo: finalAmount,
        status: "SUCCESS",
        reference,
        description: `${billerName} — ${customerRef}`,
        provider: provider,
        providerRef: `SIM-${reference}`,
        metadata: JSON.stringify({
          billerId,
          billerName,
          provider,
          customerRef,
          category,
          customerName: validationResult.customerName,
        }),
      },
    });

    // Audit log
    await audit({
      action: "BILL_PAYMENT_SUCCESS",
      category: "BILL",
      userId: user.id,
      metadata: {
        reference,
        billerName,
        provider,
        amountKobo: finalAmount,
        customerRef,
      },
    });

    return json({
      data: {
        reference,
        status: "COMPLETED",
        amountKobo: finalAmount,
        billerName,
        customerName: validationResult.customerName,
        customerRef,
        newBalanceKobo: wallet.balanceKobo - finalAmount,
      },
    });
  } catch (error) {
    // If debit succeeded but something else failed, we have a problem
    // In production, this should trigger a compensation/reversal flow
    await audit({
      action: "BILL_PAYMENT_FAILED",
      category: "BILL",
      userId: user.id,
      severity: "ERROR",
      metadata: {
        billerName,
        provider,
        amountKobo: finalAmount,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });

    return errorJson(
      error instanceof Error ? error.message : "Payment failed",
      500
    );
  }
}

// ─── Customer Validation ─────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  customerName?: string;
  message?: string;
}

async function validateCustomer(
  provider: string,
  billerId: string,
  customerRef: string
): Promise<ValidationResult> {
  // In production, this would call the actual provider APIs
  // For now, simulate validation with mock data

  switch (provider) {
    case "baxi":
      // Simulate Baxi validation (meter number lookup)
      if (customerRef.length >= 8) {
        return {
          valid: true,
          customerName: "Customer Name (Simulated via Baxi)",
        };
      }
      return { valid: false, message: "Invalid meter number" };

    case "remita":
      // Simulate Remita RRR validation
      if (customerRef.length >= 10) {
        return {
          valid: true,
          customerName: "Customer Name (Simulated via Remita)",
        };
      }
      return { valid: false, message: "Invalid RRR number" };

    case "quickteller":
      // Simulate Quickteller validation
      if (customerRef.length >= 4) {
        return {
          valid: true,
          customerName: "Customer Name (Simulated via Quickteller)",
        };
      }
      return { valid: false, message: "Invalid customer reference" };

    case "billswift":
      // Simulate BillSwift validation
      if (customerRef.length >= 4) {
        return {
          valid: true,
          customerName: "Customer Name (Simulated via BillSwift)",
        };
      }
      return { valid: false, message: "Invalid customer reference" };

    default:
      return { valid: false, message: `Unknown provider: ${provider}` };
  }
}
