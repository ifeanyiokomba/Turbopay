import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";

const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "KES", "GHS", "ZAR"];

/**
 * GET /api/intl/currency-wallets — list all currency wallets for the user.
 * Creates default empty wallets for supported currencies if none exist.
 */
export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let wallets = await db.currencyWallet.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  // Auto-create wallets for supported currencies if user has none yet
  if (wallets.length === 0) {
    const created = await Promise.all(
      SUPPORTED_CURRENCIES.map((currency) =>
        db.currencyWallet.create({
          data: { userId: user.id, currency },
        })
      )
    );
    wallets = created;
  }

  return json({ data: wallets });
}

/**
 * POST /api/intl/currency-wallets — create a single currency wallet on demand.
 * Body: { currency: string }
 */
export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { currency } = body as { currency?: string };
  if (!currency) return errorJson("Missing currency", 422);
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    return errorJson(`Unsupported currency. Supported: ${SUPPORTED_CURRENCIES.join(", ")}`, 422);
  }

  // Check if wallet already exists
  const existing = await db.currencyWallet.findFirst({ where: { userId: user.id, currency } });
  if (existing) return json({ data: existing });

  const wallet = await db.currencyWallet.create({
    data: { userId: user.id, currency },
  });

  return json({ data: wallet });
}

/**
 * PATCH /api/intl/currency-wallets — update a currency wallet (e.g. nickname).
 */
export async function PATCH(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { id, status } = body as { id?: string; status?: string };
  if (!id) return errorJson("Missing wallet id", 422);

  const wallet = await db.currencyWallet.findFirst({ where: { id, userId: user.id } });
  if (!wallet) return errorJson("Wallet not found", 404);

  if (status && ["ACTIVE", "FROZEN", "CLOSED"].includes(status)) {
    await db.currencyWallet.update({ where: { id }, data: { status } });
  }

  const updated = await db.currencyWallet.findUnique({ where: { id } });
  return json({ data: updated });
}
