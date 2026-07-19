/**
 * Trust Center Homepage API
 * ==========================
 *
 * GET /api/trust/homepage — Returns all trust data for the homepage.
 * Public endpoint — no auth required. Cached for 5 minutes.
 *
 * Returns:
 * - PCI DSS compliance status (only if verified + display enabled)
 * - Active compliance certificates
 * - Enabled security badges
 * - Enabled provider logos
 * - Enabled trust messages
 */

import { json } from "@/lib/turbopay/api";
import { trustCenter } from "@/lib/turbocore/services/trust-center";

export async function GET() {
  const data = await trustCenter.getHomepageData();
  return json({ data });
}
