import { listProviders } from "@/lib/turbocore/providers/registry";
import { requireAdmin } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";

/** GET /api/turbocore/platform — platform info: active providers, health. */
export async function GET() {
  try { await requireAdmin(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({
    data: {
      platform: "turbocore",
      version: "1.0.0",
      products: ["turbopay", "billswift"],
      providers: await listProviders(),
      webhooks: ["monnify", "intl-receiving"],
    },
  });
}
