import { requireUser } from "@/lib/turbopay/auth";
import { investments } from "@/lib/turbocore/investments";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET() {
  try { await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await investments.listCatalog() });
}
