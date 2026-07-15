import { requireUser } from "@/lib/turbopay/auth";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json, handleError } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { bulkPaymentService } from "@/lib/turbopay/services/bulk-payment.service";
import { z } from "zod";

const CATEGORIES = [
  "wallet_credit", "bank_transfer", "airtime", "data",
  "electricity", "utility", "remita", "quickteller", "international",
] as const;

const itemSchema = z.object({
  recipient: z.string().min(1),
  amountKobo: z.number().int().positive().max(500_000_000), // Max ₦5,000,000 per item
  category: z.enum(CATEGORIES),
  recipientName: z.string().max(200).optional(),
  bankCode: z.string().max(10).optional(),
  narration: z.string().max(200).optional(),
  network: z.string().max(10).optional(),
  meterNumber: z.string().max(20).optional(),
  meterType: z.enum(["prepaid", "postpaid"]).optional(),
  discoCode: z.string().max(10).optional(),
  billerCode: z.string().max(20).optional(),
  customerReference: z.string().max(50).optional(),
  billerId: z.string().max(20).optional(),
  countryCode: z.string().max(5).optional(),
  beneficiaryName: z.string().max(200).optional(),
  beneficiaryAccount: z.string().max(30).optional(),
  beneficiaryBank: z.string().max(100).optional(),
  idempotencyKey: z.string().max(100).optional(),
});

const schema = z.object({
  items: z.array(itemSchema).min(1).max(500),
});

/**
 * POST /api/bulk-payments — Create a bulk payment batch.
 * GET /api/bulk-payments?id=xxx — Get batch status.
 */
export async function POST(req: Request) {
  // Bulk payments are admin-only.
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const limited = await rateLimit(req, { key: "bulk-payment", limit: 3, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  }

  try {
    const job = await bulkPaymentService.createJob(user.id, parsed.data.items);
    return json({ data: job }, 201);
  } catch (e: any) {
    return handleError(e);
  }
}

export async function GET(req: Request) {
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  let user;
  try { user = await requireUser(); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get("id");
  if (!jobId) return errorJson("Missing job ID", 400);

  const job = await bulkPaymentService.getJob(jobId);
  if (!job) return errorJson("Job not found", 404);
  if (job.userId !== user.id) return errorJson("Forbidden", 403);

  return json({ data: job });
}
