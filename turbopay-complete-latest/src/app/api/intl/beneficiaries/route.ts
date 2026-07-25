import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { intlTransferService } from "@/lib/turbopay/services/intl-transfer.service";
import { ServiceError } from "@/lib/turbopay/services/types";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  country: z.string().min(2).max(3),
  bankName: z.string().max(200).optional(),
  accountNumber: z.string().max(50).optional(),
  swiftCode: z.string().max(20).optional(),
  routingNumber: z.string().max(20).optional(),
  mobileWallet: z.string().max(100).optional(),
  nickname: z.string().max(50).optional(),
  currency: z.string().length(3).optional(),
});

export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  try {
    const beneficiaries = await intlTransferService.beneficiaries(user.id);
    return json({ data: beneficiaries });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message || "Failed to load beneficiaries", 500);
  }
}

export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const limited = await rateLimit(req, { key: "intl-ben-create", limit: 20, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  try {
    const beneficiary = await intlTransferService.createBeneficiary(user.id, parsed.data);
    return json({ data: beneficiary }, 201);
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message || "Failed to create beneficiary", 500);
  }
}

export async function DELETE(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return errorJson("Missing id", 422);

  try {
    await intlTransferService.deleteBeneficiary(user.id, id);
    return json({ data: { deleted: true } });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message || "Failed to delete beneficiary", 500);
  }
}

export async function PATCH(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { id, isFavourite, nickname } = body as { id?: string; isFavourite?: boolean; nickname?: string };
  if (!id) return errorJson("Missing id", 422);

  try {
    const updated = await intlTransferService.updateBeneficiary(user.id, id, { isFavourite, nickname });
    return json({ data: updated });
  } catch (e: any) {
    if (e instanceof ServiceError) return errorJson(e.message, e.status, e.code);
    return errorJson(e.message || "Failed to update beneficiary", 500);
  }
}
