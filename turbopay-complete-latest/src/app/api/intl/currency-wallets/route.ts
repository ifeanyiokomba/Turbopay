import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { intlTransferService } from "@/lib/turbopay/services/intl-transfer.service";
import { ServiceError } from "@/lib/turbopay/services/types";

export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  try {
    const wallets = await intlTransferService.currencyWallets(user.id);
    return json({ data: wallets });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message || "Failed to load wallets", 500);
  }
}

export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { currency } = body as { currency?: string };
  if (!currency) return errorJson("Missing currency", 422);

  try {
    const wallet = await intlTransferService.createCurrencyWallet(user.id, currency);
    return json({ data: wallet });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message || "Failed to create wallet", 500);
  }
}

export async function PATCH(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { id, status } = body as { id?: string; status?: string };
  if (!id) return errorJson("Missing wallet id", 422);

  try {
    const updated = await intlTransferService.updateCurrencyWallet(user.id, id, { status });
    return json({ data: updated });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message || "Failed to update wallet", 500);
  }
}
