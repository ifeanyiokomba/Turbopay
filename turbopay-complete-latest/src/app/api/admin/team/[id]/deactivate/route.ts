import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";

/**
 * ADMIN — deactivate a team member (set status = SUSPENDED + freeze wallet).
 * Refuses to deactivate the last remaining admin.
 */
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requirePermission(Permissions.ADMIN_MANAGE_TEAM);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { id } = await params;

  const member = await db.user.findUnique({ where: { id }, include: { wallet: true } });
  if (!member) return errorJson("Team member not found", 404, "NOT_FOUND");
  if (member.role === "USER") {
    return errorJson("Target user is not a team member", 409, "NOT_TEAM_MEMBER");
  }
  if (member.status === "SUSPENDED" || member.status === "CLOSED") {
    return errorJson("Team member is already inactive", 409, "ALREADY_INACTIVE");
  }
  // Self-deactivation guard.
  if (member.id === actor.id) {
    return errorJson("You cannot deactivate your own account", 409, "SELF_DEACTIVATE");
  }
  // Last-admin guard.
  if (member.role === "ADMIN") {
    const adminCount = await db.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
    if (adminCount <= 1) {
      return errorJson(
        "Cannot deactivate the last remaining admin — promote another user first.",
        409,
        "LAST_ADMIN"
      );
    }
  }

  const updated = await db.user.update({
    where: { id },
    data: { status: "SUSPENDED" },
  });

  // Freeze any wallet the team member has (belt-and-braces).
  let walletFroze = false;
  if (member.wallet && member.wallet.status === "ACTIVE") {
    await db.wallet.update({
      where: { id: member.wallet.id },
      data: { status: "FROZEN" },
    });
    walletFroze = true;
  }

  // Revoke all active sessions for this user.
  await db.session.updateMany({
    where: { userId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await audit({
    userId: actor.id,
    action: "TEAM_MEMBER_DEACTIVATED",
    category: "ADMIN",
    severity: "CRITICAL",
    metadata: {
      memberId: id,
      memberEmailMasked: maskEmail(member.email),
      memberPhoneMasked: member.phone ? maskPhone(member.phone) : null,
      previousStatus: member.status,
      role: member.role,
      walletFroze,
      deactivatedBy: actor.id,
      deactivatedByName: actor.fullName,
    },
  });

  return json({
    data: {
      id: updated.id,
      fullName: updated.fullName,
      status: updated.status,
      previousStatus: member.status,
      walletFroze,
      sessionsRevoked: true,
    },
  });
}
