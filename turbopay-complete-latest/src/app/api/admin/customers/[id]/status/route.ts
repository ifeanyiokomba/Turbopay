import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";
import { z } from "zod";
import { complianceCases } from "@/lib/turbocore/compliance/cases";

/**
 * ADMIN — update a customer's account status.
 *  - FROZEN / SUSPENDED → wallet is also frozen (no debits/credits).
 *  - SUSPENDED → a compliance case is auto-opened for review.
 *  - ACTIVE → wallet is re-activated (funds accessible again).
 */
const schema = z.object({
  status: z.enum(["ACTIVE", "FROZEN", "SUSPENDED", "CLOSED"]),
  reason: z.string().min(2).max(500),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const { status, reason } = parsed.data;

  const user = await db.user.findUnique({ where: { id }, include: { wallet: true } });
  if (!user) return errorJson("Customer not found", 404, "NOT_FOUND");

  const previousStatus = user.status;
  if (previousStatus === status) {
    return errorJson(`Customer is already ${status}`, 409, "NO_CHANGE");
  }

  // Atomic status update.
  const updated = await db.user.update({
    where: { id },
    data: { status },
  });

  // Wallet handling: freeze for FROZEN/SUSPENDED; reactivate for ACTIVE.
  let walletUpdated = false;
  if (user.wallet) {
    if (status === "FROZEN" || status === "SUSPENDED") {
      await db.wallet.updateMany({
        where: { id: user.wallet.id, status: "ACTIVE" },
        data: { status: "FROZEN" },
      });
      walletUpdated = true;
    } else if (status === "ACTIVE") {
      await db.wallet.updateMany({
        where: { id: user.wallet.id, status: "FROZEN" },
        data: { status: "ACTIVE" },
      });
      walletUpdated = true;
    }
  }

  // SUSPENDED → open a compliance case for review.
  let complianceCase: Awaited<ReturnType<typeof complianceCases.openCase>> | null = null;
  if (status === "SUSPENDED") {
    try {
      complianceCase = await complianceCases.openCase(
        id,
        "REVIEW",
        "HIGH",
        `Account suspended by ${actor.fullName}: ${reason}`,
        undefined,
        { id: actor.id, name: actor.fullName }
      );
    } catch {
      /* compliance module optional */
    }
  }

  await audit({
    userId: actor.id,
    action: "CUSTOMER_STATUS_UPDATED",
    category: "ADMIN",
    severity: status === "SUSPENDED" || status === "CLOSED" ? "CRITICAL" : "WARN",
    metadata: {
      customerId: id,
      customerEmailMasked: maskEmail(user.email),
      customerPhoneMasked: user.phone ? maskPhone(user.phone) : null,
      previousStatus,
      newStatus: status,
      reason,
      walletUpdated,
      complianceCaseId: complianceCase?.id ?? null,
    },
  });

  return json({
    data: {
      user: {
        id: updated.id,
        status: updated.status,
        previousStatus,
      },
      walletFroze: walletUpdated && (status === "FROZEN" || status === "SUSPENDED"),
      walletUnfroze: walletUpdated && status === "ACTIVE",
      complianceCase: complianceCase
        ? {
            id: complianceCase.id,
            type: complianceCase.type,
            status: complianceCase.status,
            severity: complianceCase.severity,
          }
        : null,
    },
  });
}
