/**
 * MTN Mobile Money (MoMo) Adapter
 * =================================
 *
 * Implements the IMobileMoneyProvider interface for MTN MoMo.
 * Supports collections (receive) and disbursements (send) across Africa.
 *
 * API Documentation: https://momodeveloper.mtn.com/api-documentation
 */

import type {
  IMobileMoneyProvider,
  MobileMoneyCollectionInput,
  MobileMoneyDisbursementInput,
  MobileMoneyResult,
  MobileMoneyBalanceResult,
  MobileMoneyConfig,
} from "../interfaces/mobile-money";
import type { ProviderResult } from "../interfaces";
import type { Currency } from "../../types";

export class MtnMomoAdapter implements IMobileMoneyProvider {
  readonly name = "mtn-momo" as const;
  readonly displayName = "MTN Mobile Money";
  readonly supportedCountries = ["NG", "GH", "UG", "TZ", "ZA", "CM", "CI", "RW", "ZM", "MW"];
  readonly supportedCurrencies: Currency[] = ["NGN", "GHS", "UGX", "TZS", "ZAR", "XAF", "XOF", "RWF", "ZMW", "MWK"];

  private config: MobileMoneyConfig | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  async initialize(config: MobileMoneyConfig): Promise<void> {
    this.config = config;
    await this.authenticate();
  }

  private async authenticate(): Promise<void> {
    if (!this.config?.apiUser || !this.config?.apiKey) {
      throw new Error("MTN MoMo credentials not configured");
    }

    try {
      const baseUrl = this.config.environment === "production" 
        ? "https://proxy.momoapi.mtn.com" 
        : "https://sandbox.momodeveloper.mtn.com";

      const response = await fetch(`${baseUrl}/collection/token/`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${Buffer.from(`${this.config.apiUser}:${this.config.apiKey}`).toString("base64")}`,
          "Ocp-Apim-Subscription-Key": this.config.subscriptionKey || "",
        },
      });

      if (!response.ok) {
        throw new Error(`MTN MoMo authentication failed: ${response.status}`);
      }

      const data = await response.json() as any;
      this.accessToken = data.access_token;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000);
    } catch (error) {
      console.error("[MtnMomo] Authentication failed:", error);
      throw error;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (!this.accessToken || (this.tokenExpiry && this.tokenExpiry <= new Date())) {
      await this.authenticate();
    }
    return this.accessToken!;
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      await this.getAccessToken();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { 
        healthy: false, 
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  }

  async collect(input: MobileMoneyCollectionInput): Promise<ProviderResult<MobileMoneyResult>> {
    if (!this.config) {
      return { ok: false, error: { code: "NOT_INITIALIZED", message: "Provider not initialized" } };
    }

    try {
      const baseUrl = this.config.environment === "production" 
        ? "https://proxy.momoapi.mtn.com" 
        : "https://sandbox.momodeveloper.mtn.com";

      const accessToken = await this.getAccessToken();
      
      const response = await fetch(`${baseUrl}/collection/v1_0/requesttopay`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "X-Reference-Id": input.reference,
          "X-Target-Environment": this.config.environment,
          "Ocp-Apim-Subscription-Key": this.config.subscriptionKey || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: (input.amountMinor / 100).toString(),
          currency: input.currency,
          externalId: input.reference,
          payer: {
            partyIdType: "MSISDN",
            partyId: input.phoneNumber.replace("+", ""),
          },
          payerMessage: input.description || "Payment to TurboPay",
          payeeNote: `TurboPay collection: ${input.reference}`,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as any;
        return {
          ok: false,
          error: {
            code: errorData.code || "COLLECTION_FAILED",
            message: errorData.message || `Collection failed: ${response.status}`,
          },
        };
      }

      return {
        ok: true,
        data: {
          providerRef: input.reference,
          status: "PENDING",
          amountMinor: input.amountMinor,
          currency: input.currency,
          phoneNumber: input.phoneNumber,
          transactionDate: new Date(),
        },
        providerRef: input.reference,
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "COLLECTION_ERROR",
          message: error instanceof Error ? error.message : "Collection failed",
        },
      };
    }
  }

  async disburse(input: MobileMoneyDisbursementInput): Promise<ProviderResult<MobileMoneyResult>> {
    if (!this.config) {
      return { ok: false, error: { code: "NOT_INITIALIZED", message: "Provider not initialized" } };
    }

    try {
      const baseUrl = this.config.environment === "production" 
        ? "https://proxy.momoapi.mtn.com" 
        : "https://sandbox.momodeveloper.mtn.com";

      const accessToken = await this.getAccessToken();
      
      const response = await fetch(`${baseUrl}/disbursement/v1_0/transfer`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "X-Reference-Id": input.reference,
          "X-Target-Environment": this.config.environment,
          "Ocp-Apim-Subscription-Key": this.config.subscriptionKey || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: (input.amountMinor / 100).toString(),
          currency: input.currency,
          externalId: input.reference,
          payee: {
            partyIdType: "MSISDN",
            partyId: input.phoneNumber.replace("+", ""),
          },
          payerMessage: input.description || "Transfer from TurboPay",
          payeeNote: `TurboPay transfer: ${input.reference}`,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as any;
        return {
          ok: false,
          error: {
            code: errorData.code || "DISBURSEMENT_FAILED",
            message: errorData.message || `Disbursement failed: ${response.status}`,
          },
        };
      }

      return {
        ok: true,
        data: {
          providerRef: input.reference,
          status: "PENDING",
          amountMinor: input.amountMinor,
          currency: input.currency,
          phoneNumber: input.phoneNumber,
          transactionDate: new Date(),
        },
        providerRef: input.reference,
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "DISBURSEMENT_ERROR",
          message: error instanceof Error ? error.message : "Disbursement failed",
        },
      };
    }
  }

  async checkStatus(providerRef: string): Promise<ProviderResult<MobileMoneyResult>> {
    if (!this.config) {
      return { ok: false, error: { code: "NOT_INITIALIZED", message: "Provider not initialized" } };
    }

    try {
      const baseUrl = this.config.environment === "production" 
        ? "https://proxy.momoapi.mtn.com" 
        : "https://sandbox.momodeveloper.mtn.com";

      const accessToken = await this.getAccessToken();
      
      const response = await fetch(`${baseUrl}/collection/v1_0/requesttopay/${providerRef}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "X-Target-Environment": this.config.environment,
          "Ocp-Apim-Subscription-Key": this.config.subscriptionKey || "",
        },
      });

      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: "STATUS_CHECK_FAILED",
            message: `Status check failed: ${response.status}`,
          },
        };
      }

      const data = await response.json() as any;
      const status = this.mapStatus(data.status);

      return {
        ok: true,
        data: {
          providerRef,
          status,
          amountMinor: Math.round(parseFloat(data.amount || "0") * 100),
          currency: data.currency || "NGN",
          phoneNumber: data.payer?.partyId || "",
          transactionDate: new Date(data.reason || Date.now()),
        },
        providerRef,
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "STATUS_CHECK_ERROR",
          message: error instanceof Error ? error.message : "Status check failed",
        },
      };
    }
  }

  async getBalance(): Promise<ProviderResult<MobileMoneyBalanceResult>> {
    if (!this.config) {
      return { ok: false, error: { code: "NOT_INITIALIZED", message: "Provider not initialized" } };
    }

    try {
      const baseUrl = this.config.environment === "production" 
        ? "https://proxy.momoapi.mtn.com" 
        : "https://sandbox.momodeveloper.mtn.com";

      const accessToken = await this.getAccessToken();
      
      const response = await fetch(`${baseUrl}/collection/v1_0/account/balance`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "X-Target-Environment": this.config.environment,
          "Ocp-Apim-Subscription-Key": this.config.subscriptionKey || "",
        },
      });

      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: "BALANCE_CHECK_FAILED",
            message: `Balance check failed: ${response.status}`,
          },
        };
      }

      const data = await response.json() as any;

      return {
        ok: true,
        data: {
          balance: Math.round(parseFloat(data.availableBalance || "0") * 100),
          currency: this.config.currency,
          status: "ACTIVE",
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "BALANCE_CHECK_ERROR",
          message: error instanceof Error ? error.message : "Balance check failed",
        },
      };
    }
  }

  validatePhoneNumber(phone: string): boolean {
    const config = this.config ? { phoneFormat: this.getPhoneFormat() } : null;
    if (!config) return false;
    return config.phoneFormat.test(phone);
  }

  private getPhoneFormat(): RegExp {
    const country = this.config?.country || "NG";
    const formats: Record<string, RegExp> = {
      NG: /^(\+234|234|0)[789][01]\d{8}$/,
      GH: /^(\+233|233|0)[235]\d{8}$/,
      UG: /^(\+256|256|0)[7]\d{8}$/,
      TZ: /^(\+255|255|0)[67]\d{8}$/,
      ZA: /^(\+27|27|0)[678]\d{8}$/,
    };
    return formats[country] || /^\+?\d{10,15}$/;
  }

  private mapStatus(status: string): MobileMoneyResult["status"] {
    const statusMap: Record<string, MobileMoneyResult["status"]> = {
      SUCCESSFUL: "SUCCESS",
      FAILED: "FAILED",
      REJECTED: "REJECTED",
      PENDING: "PENDING",
      TIMEOUT: "FAILED",
    };
    return statusMap[status?.toUpperCase()] || "PENDING";
  }
}

export default MtnMomoAdapter;
