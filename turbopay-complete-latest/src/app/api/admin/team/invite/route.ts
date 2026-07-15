import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { hashPassword } from "@/lib/turbopay/crypto";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";
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

  // SECURITY: The temporary password is NOT returned in the response body.
  // Previously it was included in the JSON response, which meant any proxy,
  // WAF, or monitoring tool capturing admin API responses would log the
  // cleartext password. Instead, log it server-side and deliver it to the
  // invitee out-of-band (email/SMS).
  // TODO: Send tempPassword via email to the invitee using the notification system.
  console.log(`[admin:invite] Temporary password for ${email}: ${tempPassword} — deliver out-of-band`);

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
