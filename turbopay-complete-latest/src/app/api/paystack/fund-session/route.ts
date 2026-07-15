import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { db } from "@/lib/db";
import { decryptPii } from "@/lib/turbopay/crypto";
import { z } from "zod";

const schema = z.object({
  amountNaira: z.number().min(100, "Minimum amount is ₦100").max(500000, "Maximum amount is ₦500,000"),
});

/**
 * POST /api/paystack/fund-session
 *
 * Initializes a Paystack transaction for wallet funding.
 * Returns the authorization URL for redirect to Paystack checkout.
 *
 * Flow:
 *   1. User enters amount in wallet UI
 *   2. Frontend calls this endpoint
 *   3. Backend initializes Paystack transaction via POST /transaction/initialize
 *   4. Returns authorization_url for redirect
 *   5. User pays on Paystack → redirect back → webhook credits wallet
 */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "paystack-fund", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid request body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid amount", 422, "VALIDATION");

  // Get Paystack credentials from the provider config.
  const config = await db.providerConfig.findFirst({
    where: { providerName: "paystack", enabled: true, contract: "walletFunding" },
  });
  if (!config) return errorJson("Paystack is not configured. Please contact support.", 400, "PROVIDER_NOT_CONFIGURED");

  let secretKey: string;
  try {
    if (!config.credentialsEnc) throw new Error("No credentials configured");
    const creds = JSON.parse(decryptPii(config.credentialsEnc));
    secretKey = creds.secretKey;
    if (!secretKey) throw new Error("Missing secretKey");
  } catch {
    return errorJson("Paystack credentials are invalid. Please reconfigure.", 500, "CREDENTIALS_ERROR");
  }

  // Resolve virtual account for the webhook handler to credit the correct wallet.
  const va = await db.virtualAccount.findFirst({ where: { userId: user.id, status: "ACTIVE" } });

  const amountKobo = Math.round(parsed.data.amountNaira * 100);
  const reference = `tp_paystack_${user.id}_${Date.now()}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Initialize Paystack transaction.
  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountKobo,
      email: `${user.email || user.id}@turbopay.com`,
      reference,
      currency: "NGN",
      callback_url: `${appUrl}/wallet?payment=success&provider=paystack&ref=${reference}`,
      metadata: {
        userId: user.id,
        accountNumber: va?.accountNumber ?? "",
        reference,
        integration: "turbopay",
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const errBody = await res.text();
    return errorJson(`Paystack error: ${errBody}`, 502, "PAYSTACK_ERROR");
  }

  const data = await res.json() as any;
  if (!data.status || !data.data?.authorization_url) {
    return errorJson(data.message ?? "Failed to initialize payment", 502, "PAYSTACK_ERROR");
  }

  return json({
    data: {
      reference: data.data.reference,
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
    },
  });
}
