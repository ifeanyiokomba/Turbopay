import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSecurityHeadersAudit } from "@/lib/turbopay/security-headers";
import { errorJson, json } from "@/lib/turbopay/api";

/**
 * ADMIN — Security headers audit.
 *
 * Returns the active HTTP security headers + CSP configuration for admin
 * review, so operators can verify the headers are correct in production
 * without shell access to `next.config.ts`.
 *
 * RBAC-gated via the `system:view:health` permission (admin role). The
 * payload includes the active CSP, the production + development CSP
 * variants, parsed directives with rationale, and the CSRF protection
 * configuration (allowed origins, exempt routes, missing-origin policy).
 */
export async function GET() {
  try {
    await requirePermission(Permissions.SYSTEM_VIEW_HEALTH);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  return json({ data: getSecurityHeadersAudit() });
}
