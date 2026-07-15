import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { z } from "zod";

/**
 * ADMIN — approve or reject a KYC verification.
 * On APPROVE:
 *   - KYC record status → VERIFIED, verifiedAt = now
 *   - User's kycStatus → VERIFIED, kycTier → tier (only if higher than current)
 * On REJECT:
 *   - KYC record status → REJECTED
 *   - User's kycStatus → REJECTED (unless already VERIFIED at a higher tier)
 */
const schema = z.object({
  decision: z.enum(["VERIFIED", "REJECTED"]),
  reason: z.string().min(2).max(500),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requirePermission(Permissions.KYC_APPROVE);
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
  const { decision, reason } = parsed.data;

  const kyc = await db.kycVerification.findUnique({ where: { id } });
  if (!kyc) return errorJson("KYC verification not found", 404, "NOT_FOUND");

  if (kyc.status !== "PENDING") {
    return errorJson(`KYC record is already ${kyc.status}`, 409, "ALREADY_PROCESSED");
  }

  const updated = await db.kycVerification.update({
    where: { id },
    data: {
      status: decision,
      verifiedAt: decision === "VERIFIED" ? new Date() : null,
    },
  });

  // Reflect the decision on the user row.
  if (decision === "VERIFIED") {
    const user = await db.user.findUnique({ where: { id: kyc.userId } });
    if (user) {
      // Only upgrade the tier (never downgrade via this path).
      const newTier = Math.max(user.kycTier, kyc.tier);
      await db.user.update({
        where: { id: user.id },
        data: { kycStatus: "VERIFIED", kycTier: newTier },
      });
    }
  } else {
    // REJECTED — reflect on user only if they aren't already verified at a higher tier.
    const user = await db.user.findUnique({ where: { id: kyc.userId } });
    if (user && user.kycStatus !== "VERIFIED") {
      await db.user.update({
        where: { id: user.id },
        data: { kycStatus: "REJECTED" },
      });
    }
  }

  await audit({
    userId: actor.id,
    action: decision === "VERIFIED" ? "KYC_APPROVED" : "KYC_REJECTED",
    category: "KYC",
    severity: decision === "VERIFIED" ? "INFO" : "WARN",
    metadata: {
      kycId: id,
      customerId: kyc.userId,
      tier: kyc.tier,
      decision,
      reason,
      reviewerId: actor.id,
      reviewerName: actor.fullName,
    },
  });

  return json({
    data: {
      id: updated.id,
      status: updated.status,
      verifiedAt: updated.verifiedAt?.toISOString() ?? null,
      decision,
    },
  });
}
