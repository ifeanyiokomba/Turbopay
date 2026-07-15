import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json, handleError } from "@/lib/turbopay/api";
import { bulkPaymentService } from "@/lib/turbopay/services/bulk-payment.service";

/**
 * GET /api/admin/bulk-payments — List all bulk payment jobs (admin).
 */
export async function GET(req: Request) {
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
  const status = url.searchParams.get("status") ?? undefined;

  try {
    const result = await bulkPaymentService.listJobs({ page, limit, status });
    return json({ data: result });
  } catch (e: any) {
    return handleError(e);
  }
}
