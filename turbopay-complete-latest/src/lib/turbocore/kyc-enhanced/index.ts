import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const ADDRESS_DOCUMENT_TYPES = ["UTILITY_BILL", "BANK_STATEMENT", "TENANCY_AGREEMENT", "GOVT_RESIDENCE"] as const;

class EnhancedKycService {
  /** Submit proof of address for verification. */
  async submitAddress(userId: string, input: {
    residentialAddress: string; state: string; lga?: string; city: string; postalCode?: string;
    documentType: string; documentBase64: string; // base64 data URL
  }) {
    // Validate document type
    if (!ADDRESS_DOCUMENT_TYPES.includes(input.documentType as any)) throw new Error("Invalid document type");

    // Save document
    const uploadDir = join(process.cwd(), "public", "uploads", "kyc");
    mkdirSync(uploadDir, { recursive: true });
    const match = input.documentBase64.match(/^data:(application\/pdf|image\/(jpeg|png|webp));base64,(.+)$/);
    if (!match) throw new Error("Invalid document format. Use PDF, JPEG, PNG, or WebP.");
    const [, , , base64Data] = match;
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length > 5 * 1024 * 1024) throw new Error("Document too large. Max 5MB.");
    const ext = match[1].includes("pdf") ? "pdf" : match[1].includes("png") ? "png" : "jpg";
    const filename = `${userId}-address-${Date.now()}.${ext}`;
    writeFileSync(join(uploadDir, filename), buffer);
    const documentPath = `/uploads/kyc/${filename}`;

    const verification = await db.addressVerification.create({
      data: {
        userId, residentialAddress: input.residentialAddress, state: input.state, lga: input.lga,
        city: input.city, postalCode: input.postalCode, country: "Nigeria",
        documentType: input.documentType, documentPath, status: "PENDING",
      },
    });

    await audit({ userId, action: "ADDRESS_VERIFICATION_SUBMITTED", category: "KYC", metadata: { verificationId: verification.id, documentType: input.documentType } });
    return verification;
  }

  /** Admin: review address verification. */
  async reviewAddress(verificationId: string, input: { decision: "APPROVED" | "REJECTED" | "RESUBMIT"; notes?: string; reviewerId: string; reviewerName: string }) {
    const updated = await db.addressVerification.update({
      where: { id: verificationId },
      data: { status: input.decision, reviewerId: input.reviewerId, reviewerName: input.reviewerName, reviewedAt: new Date(), reviewNotes: input.notes ?? null },
    });
    await audit({ userId: input.reviewerId, action: "ADDRESS_VERIFICATION_REVIEWED", category: "KYC", metadata: { verificationId, decision: input.decision } });
    return updated;
  }

  /** Get address verification status for a user. */
  async getUserAddressStatus(userId: string) {
    return db.addressVerification.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  }

  /** List pending address verifications (admin). */
  async listPending(page = 1, limit = 50) {
    const [items, total] = await Promise.all([
      db.addressVerification.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: limit, skip: (page - 1) * limit, include: { user: { select: { fullName: true, email: true } } } }),
      db.addressVerification.count({ where: { status: "PENDING" } }),
    ]);
    return { items, total, page, limit };
  }
}

export const enhancedKyc = new EnhancedKycService();
export { ADDRESS_DOCUMENT_TYPES };
