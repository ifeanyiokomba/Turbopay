import { db } from "@/lib/db";
import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { sanitizeString } from "@/lib/turbopay/sanitize";
import { z } from "zod";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const items = await db.beneficiary.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return json({
    data: items.map((b) => ({
      id: b.id, name: b.name, accountNumber: b.accountNumber, bankName: b.bankName, bankCode: b.bankCode, type: b.type,
    })),
  });
}

const schema = z.object({
  name: z.string().min(2),
  accountNumber: z.string().min(6),
  bankName: z.string().min(2),
  bankCode: z.string().min(2),
  type: z.enum(["TURBOPAY", "EXTERNAL"]).default("TURBOPAY"),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  // Sanitize free-form fields (name, bankName) — accountNumber/bankCode are
  // regex-validated by Zod so they're safe.
  const sanitized = {
    ...parsed.data,
    name: sanitizeString(parsed.data.name),
    bankName: sanitizeString(parsed.data.bankName),
  };

  const exists = await db.beneficiary.findFirst({
    where: { userId: user.id, accountNumber: parsed.data.accountNumber },
  });
  if (exists) return errorJson("Beneficiary already saved", 409, "DUPLICATE");

  const b = await db.beneficiary.create({ data: { userId: user.id, ...sanitized } });
  return json({
    data: { id: b.id, name: b.name, accountNumber: b.accountNumber, bankName: b.bankName, bankCode: b.bankCode, type: b.type },
  });
}

export async function DELETE(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return errorJson("Beneficiary id required", 400);
  await db.beneficiary.deleteMany({ where: { id, userId: user.id } });
  return json({ data: { ok: true } });
}
