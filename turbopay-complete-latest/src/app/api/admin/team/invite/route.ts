import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { hashPassword } from "@/lib/turbopay/crypto";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";
import { notify } from "@/lib/turbocore/notifications";
import { z } from "zod";
import * as crypto from "node:crypto";

/**
 * ADMIN — invite a new team member.
 * Creates a User row with the given role (one of ADMIN/SUPPORT/COMPLIANCE/FINANCE)
 * and a temporary random password that the invited user must reset on first login.
 */
const schema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(7).max(20),
  role: z.enum(["ADMIN", "SUPPORT", "COMPLIANCE", "FINANCE"]),
});

function randomPassword(): string {
  // 18 URL-safe base64 chars (~108 bits of entropy). The invitee resets this on first login.
  return crypto.randomBytes(14).toString("base64url");
}

export async function POST(req: Request) {
  let actor;
  try {
    actor = await requirePermission(Permissions.ADMIN_MANAGE_TEAM);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

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
  const { fullName, email, phone, role } = parsed.data;

  const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    return errorJson("A user with this email already exists", 409, "DUPLICATE_EMAIL");
  }
  const existingPhone = await db.user.findUnique({ where: { phone } });
  if (existingPhone) {
    return errorJson("A user with this phone already exists", 409, "DUPLICATE_PHONE");
  }

  const tempPassword = randomPassword();
  const created = await db.user.create({
    data: {
      fullName,
      email: email.toLowerCase(),
      phone,
      passwordHash: hashPassword(tempPassword),
      role,
      kycTier: 3, // staff accounts operate at the highest tier
      kycStatus: "VERIFIED",
      emailVerified: false,
      phoneVerified: false,
      status: "ACTIVE",
    },
  });

  // Audit + mask PII in the audit trail.
  await audit({
    userId: actor.id,
    action: "TEAM_MEMBER_INVITED",
    category: "ADMIN",
    severity: "WARN",
    metadata: {
      newUserId: created.id,
      newUserName: fullName,
      newUserEmailMasked: maskEmail(email),
      newUserPhoneMasked: maskPhone(phone),
      role,
      invitedBy: actor.id,
      invitedByName: actor.fullName,
    },
  });

  // SECURITY: Send temp password via email — never log it to stdout or include in response.
  // The invitee must reset this password on first login.
  try {
    await notify.send({
      to: email,
      channel: "EMAIL",
      template: "admin.invite",
      variables: {
        userName: fullName.split(" ")[0],
        tempPassword,
        invitedByName: actor.fullName,
      },
    });
  } catch (e) {
    // If email fails, log a warning but don't expose the password.
    // The admin can manually share it out-of-band.
    console.error(`[admin:invite] Failed to send invite email to ${maskEmail(email)}`, (e as Error).message);
  }

  return json(
    {
      data: {
        id: created.id,
        fullName: created.fullName,
        email: created.email,
        emailMasked: maskEmail(created.email),
        phoneMasked: created.phone ? maskPhone(created.phone) : null,
        role: created.role,
        status: created.status,
        createdAt: created.createdAt.toISOString(),
      },
    },
    201
  );
}
