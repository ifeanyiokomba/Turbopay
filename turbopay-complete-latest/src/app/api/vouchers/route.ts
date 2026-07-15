import { requireUser } from "@/lib/turbopay/auth";
import { vouchers } from "@/lib/turbocore/vouchers";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET() {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  // Return both available vouchers/rewards AND the user's redemption history
  // so the Vouchers view can render a complete picture in one round-trip.
  const [available, history] = await Promise.all([
    vouchers.getAvailableForUser(user.id),
    vouchers.getUserHistory(user.id),
  ]);
  return json({ data: { ...available, history } });
}
