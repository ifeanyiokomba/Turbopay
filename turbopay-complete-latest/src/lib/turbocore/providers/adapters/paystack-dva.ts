/**
 * Paystack Dedicated Virtual Account (DVA) Provider.
 * ---------------------------------------------------
 * Implements `IVirtualAccountProvider` against the Paystack Dedicated
 * Virtual Account API.
 *
 * Flow:
 *   1. Create a dedicated virtual account for a customer (POST /dedicated_account)
 *   2. Customer transfers to the VA → Paystack fires charge.success webhook
 *   3. processFunding() credits the wallet via processFunding()
 *
 * Paystack DVA returns: account_number, bank_name, bank_id, account_name.
 * The account is linked to the customer's Paystack customer code.
 *
 * Credentials come from adapter-factory (decrypted DB ProviderConfig).
 * Expected keys: secretKey, baseUrl.
 */
import type {
  IVirtualAccountProvider,
  VirtualAccountDetails,
  ProviderContext,
  ProviderResult,
} from "../interfaces";
import { jsonRequest, toProviderError } from "./_http";

interface PaystackDvaCreateResponse {
  status: boolean;
  message?: string;
  data?: {
    id: number;
    account_number: string;
    account_name: string;
    bank_name: string;
    bank_id: number;
    currency: string;
    split_config: Record<string, unknown>;
  };
}

interface PaystackDvaListResponse {
  status: boolean;
  message?: string;
  data?: Array<{
    id: number;
    account_number: string;
    account_name: string;
    bank_name: string;
    bank_id: number;
    currency: string;
    customer: { customer_code: string };
  }>;
}

export class PaystackDvaProvider implements IVirtualAccountProvider {
  readonly name = "paystack";
  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string = "https://api.paystack.co",
  ) {}

  async createReservedAccount(
    accountName: string,
    customerRef: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<VirtualAccountDetails>> {
    try {
      // Paystack DVA requires a customer code. We use the customerRef
      // (user ID) to create or retrieve the Paystack customer first.
      const customer = await this.ensureCustomer(accountName, customerRef);

      const res = await jsonRequest<PaystackDvaCreateResponse>({
        url: `${this.baseUrl}/dedicated_account`,
        method: "POST",
        headers: { Authorization: `Bearer ${this.secretKey}` },
        body: {
          customer: customer.customerCode,
          preferred_bank: "wema-bank", // Paystack's default DVA bank
          currency: "NGN",
        },
      });

      if (!res.data?.data?.account_number) {
        return { ok: false, error: { code: "DVA_CREATE_FAILED", message: "No account number in response" } };
      }

      const dva = res.data.data;
      return {
        ok: true,
        data: {
          accountNumber: dva.account_number,
          accountName: dva.account_name,
          bankName: dva.bank_name,
          bankCode: String(dva.bank_id),
          providerRef: String(dva.id),
          currency: "NGN",
        },
        providerRef: String(dva.id),
      };
    } catch (e) {
      return { ok: false, error: toProviderError(e) };
    }
  }

  async closeAccount(
    providerRef: string,
  ): Promise<ProviderResult<{ closed: boolean }>> {
    try {
      await jsonRequest({
        url: `${this.baseUrl}/dedicated_account/${providerRef}`,
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.secretKey}` },
      });

      return { ok: true, data: { closed: true } };
    } catch (e) {
      return { ok: false, error: toProviderError(e) };
    }
  }

  /**
   * Ensure a Paystack customer exists for this user.
   * Creates one if not found. Returns the customer code.
   */
  private async ensureCustomer(
    name: string,
    userId: string,
  ): Promise<{ customerCode: string }> {
    // Try to create customer — Paystack returns existing if email matches.
    const email = `user-${userId}@turbopay.paystack`;
    const res = await jsonRequest<{ data?: { customer_code: string } }>({
      url: `${this.baseUrl}/customer`,
      method: "POST",
      headers: { Authorization: `Bearer ${this.secretKey}` },
      body: {
        email,
        first_name: name.split(" ")[0] ?? name,
        last_name: name.split(" ").slice(1).join(" ") || "User",
        phone: "",
      },
    });

    if (!res.data?.data?.customer_code) {
      throw new Error("Failed to create Paystack customer");
    }

    return { customerCode: res.data.data.customer_code };
  }
}
