import { requireUser, readIp } from "@/lib/turbopay/auth";
import { errorJson, json, idempotencyKey, handleError } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { transferService, ServiceError } from "@/lib/turbopay/services";
import { DomainError } from "@/lib/turbopay/errors";
import { randomToken } from "@/lib/turbopay/crypto";
import { z } from "zod";

const schema = z
  .object({
    recipient: z.string().min(3, "Enter recipient phone, email, or Turbopay account").optional(),
    accountNumber: z.string().regex(/^\d{10}$/, "Account number must be 10 digits").optional(),
    bankCode: z.string().min(3, "Bank code is required").max(6).optional(),
    bankName: z.string().max(60).optional(),
    recipientName: z.string().max(80).optional(),
    amountNaira: z.number().min(50, "Minimum transfer is ₦50").max(5000000, "Amount too large"),
    note: z.string().max(100).optional(),
    saveBeneficiary: z.boolean().optional(),
    pin: z.string().regex(/^\d{4}$/, "Transaction PIN is required"),
  })
  .refine((d) => !!d.recipient || (!!d.accountNumber && !!d.bankCode), {
    message: "Provide a Turbopay recipient, or a bank account number + bank code for an external transfer",
    path: ["recipient"],
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
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");
  }

  // Per-user rate limit on PIN attempts — brute-force defense.
  const limited = await rateLimit(req, { key: "pin", limit: 10, windowMs: 60_000, scope: "user", userId: user.id });
  if (limited) return limited;

  // Generate a server-side idempotency key if the client didn't provide one.
  // Without this, network retries after a timeout could cause duplicate transfers.
  const idemKey = idempotencyKey(req.headers) ?? `xfer-${user.id}-${Date.now()}-${randomToken(8)}`;

  try {
    const result = await transferService.send({
      user,
      recipient: parsed.data.recipient,
      accountNumber: parsed.data.accountNumber,
      bankCode: parsed.data.bankCode,
      bankName: parsed.data.bankName,
      recipientName: parsed.data.recipientName,
      amountNaira: parsed.data.amountNaira,
      note: parsed.data.note,
      saveBeneficiary: parsed.data.saveBeneficiary,
      pin: parsed.data.pin,
      ip: readIp(req.headers),
      idemKey,
    });
    return json({ data: result });
  } catch (e: any) {
    return handleError(e);
  }
}
