import { requireUser } from "@/lib/turbopay/auth";
import { walletService } from "@/lib/turbopay/services/wallet.service";
import { ServiceError } from "@/lib/turbopay/services/types";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  try {
    const result = await walletService.getWallet(user.id);
    return json({ data: result });
  } catch (e: any) {
    if (e instanceof ServiceError) {
      return errorJson(e.message, e.status, e.code);
    }
    return errorJson(e.message || "Failed to load wallet", 500);
  }
}
