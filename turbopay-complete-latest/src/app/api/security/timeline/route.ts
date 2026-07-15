import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { getSecurityTimeline } from "@/lib/turbocore/security";

/** GET /api/security/timeline — unified security event timeline. */
export async function GET(req: Request) {
  const limited = await rateLimit(req, { key: "security-timeline", limit: 10, windowMs: 60_000, scope: "user" });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
  const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : undefined;
  const timeline = await getSecurityTimeline(user.id, { limit, offset });
  return json({ data: timeline });
}
