import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { listDevices } from "@/lib/turbocore/security";

/** GET /api/security/devices — list the user's registered devices. */
export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const devices = await listDevices(user.id);
  return json({ data: devices });
}
