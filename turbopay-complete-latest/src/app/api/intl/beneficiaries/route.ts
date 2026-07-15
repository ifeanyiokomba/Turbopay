import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";
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

/**
 * GET /api/intl/beneficiaries — list international beneficiaries.
 */
export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const beneficiaries = await db.internationalBeneficiary.findMany({
    where: { userId: user.id },
    orderBy: [{ isFavourite: "desc" }, { createdAt: "desc" }],
  });

  return json({ data: beneficiaries });
}

/**
 * POST /api/intl/beneficiaries — create a new international beneficiary.
 */
export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const limited = await rateLimit(req, { key: "intl-ben-create", limit: 20, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const beneficiary = await db.internationalBeneficiary.create({
    data: { ...parsed.data, userId: user.id, currency: parsed.data.currency ?? "USD" },
  });

  return json({ data: beneficiary }, 201);
}

/**
 * DELETE /api/intl/beneficiaries?id=xxx — delete an international beneficiary.
 */
export async function DELETE(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return errorJson("Missing id", 422);

  const beneficiary = await db.internationalBeneficiary.findFirst({ where: { id, userId: user.id } });
  if (!beneficiary) return errorJson("Beneficiary not found", 404);

  await db.internationalBeneficiary.delete({ where: { id } });
  return json({ data: { deleted: true } });
}

/**
 * PATCH /api/intl/beneficiaries — update favourite or other fields.
 */
export async function PATCH(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { id, isFavourite, nickname } = body as { id?: string; isFavourite?: boolean; nickname?: string };
  if (!id) return errorJson("Missing id", 422);

  const beneficiary = await db.internationalBeneficiary.findFirst({ where: { id, userId: user.id } });
  if (!beneficiary) return errorJson("Beneficiary not found", 404);

  const updateData: Record<string, unknown> = {};
  if (isFavourite !== undefined) updateData.isFavourite = isFavourite;
  if (nickname !== undefined) updateData.nickname = nickname;

  const updated = await db.internationalBeneficiary.update({ where: { id }, data: updateData });
  return json({ data: updated });
}
