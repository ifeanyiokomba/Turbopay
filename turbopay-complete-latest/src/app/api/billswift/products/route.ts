import { billswift } from "@/lib/turbocore/billswift";
import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";

/** GET /api/billswift/products — list all bill products from the active provider. */
export async function GET() {
  try {
    await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const products = await billswift.listProducts();
  return json({ data: { products } });
}
