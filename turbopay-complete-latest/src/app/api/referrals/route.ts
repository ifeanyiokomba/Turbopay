import { requireUser } from "@/lib/turbopay/auth";
import { referrals } from "@/lib/turbocore/referrals";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET() {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const code = await referrals.getOrCreateCode(user.id, user.fullName);
  return json({ data: { code, link: `https://turbopay.ng/r/${code}` } });
}
