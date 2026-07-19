/**
 * Airtel Money Adapter
 * =====================
 *
 * Implements the IMobileMoneyProvider interface for Airtel Money.
 * Supports collections and disbursements across Africa.
 *
 * API Documentation: https://developers.airtel.africa/
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

export class AirtelMoneyAdapter implements IMobileMoneyProvider {
  readonly name = "airtel-money" as const;
  readonly displayName = "Airtel Money";
  readonly supportedCountries = ["NG", "GH", "KE", "UG", "TZ", "ZA", "CM", "CI", "RW", "ZM", "MW", "MG", "SS", "ZW"];
  readonly supportedCurrencies = ["NGN", "GHS", "KES", "UGX", "TZS", "ZAR", "XAF", "XOF", "RWF", "ZMW", "MWK", "MGA", "SSP", "ZWL"];

  private config: MobileMoneyConfig | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  async initialize(config: MobileMoneyConfig): Promise<void> {
    this.config = config;
    await this.authenticate();
  }

  private async authenticate(): Promise<void> {
    if (!this.config?.clientId || !this.config?.clientSecret) {
      throw new Error("Airtel Money credentials not configured");
    }

    try {
      const baseUrl = this.config.environment === "production" 
        ? "https://openapi.airtel.africa" 
        : "https://openapi.airtel.africa";

      const response = await fetch(`${baseUrl}/auth/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }),
      });

      if (!response.ok) {
        throw new Error(`Airtel Money authentication failed: ${response.status}`);
      }

      const data = await response.json() as any;
      this.accessToken = data.access_token;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000);
    } catch (error) {
      console.error("[AirtelMoney] Authentication failed:", error);
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
        ? "https://openapi.airtel.africa" 
        : "https://openapi.airtel.africa";

      const accessToken = await this.getAccessToken();
      
      const response = await fetch(`${baseUrl}/standard/v1/payments`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "X-Country": input.country,
          "X-Currency": input.currency,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transaction: {
            amount: (input.amountMinor / 100).toString(),
            country: input.country,
            currency: input.currency,
            reference: input.reference,
          },
          subscriber: {
            mobileNumber: input.phoneNumber.replace("+", ""),
          },
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
        ? "https://openapi.airtel.africa" 
        : "https://openapi.airtel.africa";

      const accessToken = await this.getAccessToken();
      
      const response = await fetch(`${baseUrl}/standard/v1/disbursements`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "X-Country": input.country,
          "X-Currency": input.currency,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transaction: {
            amount: (input.amountMinor / 100).toString(),
            country: input.country,
            currency: input.currency,
            reference: input.reference,
          },
          subscriber: {
            mobileNumber: input.phoneNumber.replace("+", ""),
          },
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
        ? "https://openapi.airtel.africa" 
        : "https://openapi.airtel.africa";

      const accessToken = await this.getAccessToken();
      
      const response = await fetch(`${baseUrl}/standard/v1/payments/${providerRef}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "X-Country": this.config.country,
          "Content-Type": "application/json",
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
      const status = this.mapStatus(data.transaction?.status);

      return {
        ok: true,
        data: {
          providerRef,
          status,
          amountMinor: Math.round(parseFloat(data.transaction?.amount || "0") * 100),
          currency: this.config.currency,
          phoneNumber: data.subscriber?.mobileNumber || "",
          transactionDate: new Date(data.transaction?.createdAt || Date.now()),
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
        ? "https://openapi.airtel.africa" 
        : "https://openapi.airtel.africa";

      const accessToken = await this.getAccessToken();
      
      const response = await fetch(`${baseUrl}/standard/v1/user/balance`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "X-Country": this.config.country,
          "Content-Type": "application/json",
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
          balance: Math.round(parseFloat(data.balance || "0") * 100),
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
    const country = this.config?.country || "NG";
    const formats: Record<string, RegExp> = {
      NG: /^(\+234|234|0)[789][01]\d{8}$/,
      GH: /^(\+233|233|0)[235]\d{8}$/,
      KE: /^(\+254|254|0)[17]\d{8}$/,
      UG: /^(\+256|256|0)[7]\d{8}$/,
      TZ: /^(\+255|255|0)[67]\d{8}$/,
      ZA: /^(\+27|27|0)[678]\d{8}$/,
    };
    const format = formats[country] || /^\+?\d{10,15}$/;
    return format.test(phone);
  }

  private mapStatus(status: string): MobileMoneyResult["status"] {
    const statusMap: Record<string, MobileMoneyResult["status"]> = {
      SUCCESS: "SUCCESS",
      FAILED: "FAILED",
      REJECTED: "REJECTED",
      PENDING: "PENDING",
      TIMEOUT: "FAILED",
      INITIATED: "PENDING",
    };
    return statusMap[status?.toUpperCase()] || "PENDING";
  }
}

export default AirtelMoneyAdapter;
