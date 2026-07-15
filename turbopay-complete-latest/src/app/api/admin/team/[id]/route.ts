import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";
import { z } from "zod";

/**
 * ADMIN — change a team member's role.
 * Refuses to demote the last remaining ADMIN (would lock the platform out).
 */
const schema = z.object({
  role: z.enum(["ADMIN", "SUPPORT", "COMPLIANCE", "FINANCE"]),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requirePermission(Permissions.ADMIN_MANAGE_TEAM);
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
  const { role } = parsed.data;

  const member = await db.user.findUnique({ where: { id } });
  if (!member) return errorJson("Team member not found", 404, "NOT_FOUND");
  if (member.role === "USER") {
    return errorJson("Target user is not a team member", 409, "NOT_TEAM_MEMBER");
  }
  if (member.role === role) {
    return errorJson(`Team member is already ${role}`, 409, "NO_CHANGE");
  }

  // Refuse to demote the last admin.
  if (member.role === "ADMIN" && role !== "ADMIN") {
    const adminCount = await db.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
    if (adminCount <= 1) {
      return errorJson(
        "Cannot demote the last remaining admin — promote another user first.",
        409,
        "LAST_ADMIN"
      );
    }
  }

  const updated = await db.user.update({
    where: { id },
    data: { role },
  });

  await audit({
    userId: actor.id,
    action: "TEAM_MEMBER_ROLE_CHANGED",
    category: "ADMIN",
    severity: "WARN",
    metadata: {
      memberId: id,
      memberEmailMasked: maskEmail(member.email),
      memberPhoneMasked: member.phone ? maskPhone(member.phone) : null,
      previousRole: member.role,
      newRole: role,
      changedBy: actor.id,
      changedByName: actor.fullName,
    },
  });

  return json({
    data: {
      id: updated.id,
      fullName: updated.fullName,
      role: updated.role,
      previousRole: member.role,
    },
  });
}
