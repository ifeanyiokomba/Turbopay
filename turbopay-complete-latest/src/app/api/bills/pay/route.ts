/**
 * Unified Bill Payment API
 * =========================
 *
 * POST /api/bills/pay — Process a bill payment via the routing engine.
 *
 * Routes to the best provider (Baxi, Remita, Quickteller, BillSwift)
 * based on the biller's provider, executes the payment, and returns the result.
 * Users never see provider complexity.
 *
 * MIGRATED: Now delegates to `billPaymentService` which routes through
 * `debitPipeline` for proper ledger entries, atomic hold/confirm, and
 * rollback on failure.
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { requireUser } from "@/lib/turbopay/auth";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { billPaymentService } from "@/lib/turbopay/services/bill-payment.service";
import { ServiceError } from "@/lib/turbopay/services/types";
import { z } from "zod";

const validateSchema = z.object({
  action: z.literal("validate"),
  billerId: z.string().min(1, "billerId is required"),
  provider: z.string().min(1, "provider is required"),
  customerRef: z.string().min(1, "customerRef is required"),
});

const paySchema = z.object({
  billerId: z.string().min(1, "billerId is required"),
  billerName: z.string().min(1, "billerName is required"),
  provider: z.string().min(1, "provider is required"),
  customerRef: z.string().min(1, "customerRef is required"),
  amountKobo: z.number().positive("amountKobo must be a positive number"),
  category: z.string().default("GENERAL"),
  fixedAmount: z.number().positive().optional(),
  pin: z.string().min(4, "PIN is required"),
});

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

  // Handle validation action
  if (body.action === "validate") {
    const parsed = validateSchema.safeParse(body);
    if (!parsed.success) {
      return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
    }

    try {
      const result = await billPaymentService.validateCustomer(parsed.data);
      return json({ data: result });
    } catch (e: any) {
      return errorJson(e.message, e.status ?? 500, e.code);
    }
  }

  // Validate payment fields
  const parsed = paySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  }

  // Process payment via service
  try {
    const result = await billPaymentService.pay({
      user,
      ...parsed.data,
      ip: req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || req.headers.get("x-real-ip") || undefined,
    });
    return json({ data: result });
  } catch (e: any) {
    if (e instanceof ServiceError) {
      return errorJson(e.message, e.status, e.code);
    }
    return errorJson(e.message || "Payment failed", 500);
  }
}
