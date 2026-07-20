/**
 * Paga Adapter
 * ============
 *
 * Implements the IMobileMoneyProvider interface for Paga.
 * Supports collections and disbursements in Nigeria and other markets.
 *
 * API Documentation: https://developer.paga.com/
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

export class PagaAdapter implements IMobileMoneyProvider {
  readonly name = "paga" as const;
  readonly displayName = "Paga";
  readonly supportedCountries = ["NG"];
  readonly supportedCurrencies: Currency[] = ["NGN"];

  private config: MobileMoneyConfig | null = null;
  private apiKey: string | null = null;

  async initialize(config: MobileMoneyConfig): Promise<void> {
    this.config = config;
    this.apiKey = config.apiKey || null;
    
    if (!this.apiKey) {
      throw new Error("Paga API key not configured");
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      // Simple health check - just verify we can reach the API
      const baseUrl = this.config?.environment === "production" 
        ? "https://www.paga.com" 
        : "https://test.paga.com";

      const response = await fetch(`${baseUrl}/api/v1/health`, {
        method: "GET",
        headers: {
          "Authorization": `PAGA_API_KEY ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      return { healthy: response.ok, latencyMs: Date.now() - start };
    } catch (error) {
      return { 
        healthy: false, 
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  }

  async collect(input: MobileMoneyCollectionInput): Promise<ProviderResult<MobileMoneyResult>> {
    if (!this.config || !this.apiKey) {
      return { ok: false, error: { code: "NOT_INITIALIZED", message: "Provider not configured" } };
    }

    try {
      const baseUrl = this.config.environment === "production" 
        ? "https://www.paga.com" 
        : "https://test.paga.com";

      const response = await fetch(`${baseUrl}/api/v1/merchant/collect`, {
        method: "POST",
        headers: {
          "Authorization": `PAGA_API_KEY ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: input.amountMinor / 100,
          currency: input.currency,
          phoneNumber: input.phoneNumber.replace("+", ""),
          reference: input.reference,
          description: input.description || "Payment to TurboPay",
          merchantId: this.config.merchantId,
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

      const data = await response.json() as any;

      return {
        ok: true,
        data: {
          providerRef: data.transactionId || input.reference,
          status: "PENDING",
          amountMinor: input.amountMinor,
          currency: input.currency,
          phoneNumber: input.phoneNumber,
          transactionDate: new Date(),
        },
        providerRef: data.transactionId || input.reference,
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
    if (!this.config || !this.apiKey) {
      return { ok: false, error: { code: "NOT_INITIALIZED", message: "Provider not configured" } };
    }

    try {
      const baseUrl = this.config.environment === "production" 
        ? "https://www.paga.com" 
        : "https://test.paga.com";

      const response = await fetch(`${baseUrl}/api/v1/merchant/disburse`, {
        method: "POST",
        headers: {
          "Authorization": `PAGA_API_KEY ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: input.amountMinor / 100,
          currency: input.currency,
          phoneNumber: input.phoneNumber.replace("+", ""),
          reference: input.reference,
          description: input.description || "Transfer from TurboPay",
          merchantId: this.config.merchantId,
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

      const data = await response.json() as any;

      return {
        ok: true,
        data: {
          providerRef: data.transactionId || input.reference,
          status: "PENDING",
          amountMinor: input.amountMinor,
          currency: input.currency,
          phoneNumber: input.phoneNumber,
          transactionDate: new Date(),
        },
        providerRef: data.transactionId || input.reference,
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
    if (!this.config || !this.apiKey) {
      return { ok: false, error: { code: "NOT_INITIALIZED", message: "Provider not configured" } };
    }

    try {
      const baseUrl = this.config.environment === "production" 
        ? "https://www.paga.com" 
        : "https://test.paga.com";

      const response = await fetch(`${baseUrl}/api/v1/merchant/transaction/${providerRef}`, {
        method: "GET",
        headers: {
          "Authorization": `PAGA_API_KEY ${this.apiKey}`,
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
      const status = this.mapStatus(data.status);

      return {
        ok: true,
        data: {
          providerRef,
          status,
          amountMinor: Math.round((data.amount || 0) * 100),
          currency: this.config.currency,
          phoneNumber: data.phoneNumber || "",
          transactionDate: new Date(data.transactionDate || Date.now()),
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
    if (!this.config || !this.apiKey) {
      return { ok: false, error: { code: "NOT_INITIALIZED", message: "Provider not configured" } };
    }

    try {
      const baseUrl = this.config.environment === "production" 
        ? "https://www.paga.com" 
        : "https://test.paga.com";

      const response = await fetch(`${baseUrl}/api/v1/merchant/balance`, {
        method: "GET",
        headers: {
          "Authorization": `PAGA_API_KEY ${this.apiKey}`,
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
          balance: Math.round((data.balance || 0) * 100),
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
    // Paga primarily supports Nigeria
    const format = /^(\+234|234|0)[789][01]\d{8}$/;
    return format.test(phone);
  }

  private mapStatus(status: string): MobileMoneyResult["status"] {
    const statusMap: Record<string, MobileMoneyResult["status"]> = {
      SUCCESS: "SUCCESS",
      COMPLETED: "SUCCESS",
      FAILED: "FAILED",
      PENDING: "PENDING",
      REJECTED: "REJECTED",
    };
    return statusMap[status?.toUpperCase()] || "PENDING";
  }
}

export default PagaAdapter;
