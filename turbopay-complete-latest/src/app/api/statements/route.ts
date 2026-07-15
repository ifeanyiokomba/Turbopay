import { requireUser } from "@/lib/turbopay/auth";
import { statements } from "@/lib/turbocore/statements";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET() {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await statements.getHistory(user.id) });
}
