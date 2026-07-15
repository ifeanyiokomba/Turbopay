import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";
import { z } from "zod";

/** POST /api/admin/customers/[id]/wallet/unfreeze — reactivate a frozen wallet. */
const schema = z.object({
  reason: z.string().min(2).max(500),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requirePermission(Permissions.ADMIN_MANAGE_USERS);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { id } = await params;

  let body;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid body", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  }
  const { reason } = parsed.data;

  const user = await db.user.findUnique({ where: { id }, include: { wallet: true } });
  if (!user) return errorJson("Customer not found", 404, "NOT_FOUND");
  if (!user.wallet) return errorJson("Wallet not found", 404, "NOT_FOUND");
  if (user.wallet.status === "ACTIVE") {
    return errorJson("Wallet is already active", 409, "ALREADY_ACTIVE");
  }

  // If the user-level status is FROZEN or SUSPENDED we refuse to unfreeze the
  // wallet alone — the account itself must be re-activated first.
  if (user.status === "FROZEN" || user.status === "SUSPENDED") {
    return errorJson(
      `Cannot unfreeze wallet while account status is ${user.status}. Re-activate the account first.`,
      409,
      "ACCOUNT_LOCKED"
    );
  }

  await db.wallet.update({
    where: { id: user.wallet.id },
    data: { status: "ACTIVE" },
  });

  await audit({
    userId: actor.id,
    action: "WALLET_UNFROZEN_BY_ADMIN",
    category: "WALLET",
    severity: "INFO",
    metadata: {
      customerId: id,
      customerEmailMasked: maskEmail(user.email),
      customerPhoneMasked: user.phone ? maskPhone(user.phone) : null,
      walletId: user.wallet.id,
      reason,
    },
  });

  return json({
    data: {
      walletId: user.wallet.id,
      status: "ACTIVE",
      reason,
    },
  });
}
