/**
 * M-Pesa Adapter
 * ==============
 *
 * Implements the IMobileMoneyProvider interface for M-Pesa (Safaricom).
 * Supports collections and disbursements in Kenya, Tanzania, and other markets.
 *
 * API Documentation: https://developer.safaricom.co.ke/APIs
 */

import { mobileMoneyRequest } from "./mobile-money-http";
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

export class MPesaAdapter implements IMobileMoneyProvider {
  readonly name = "m-pesa" as const;
  readonly displayName = "M-Pesa";
  readonly supportedCountries = ["KE", "TZ", "CD", "MZ", "LS", "SZ", "EG"];
  readonly supportedCurrencies: Currency[] = ["KES", "TZS", "CDF", "MZN", "LSL", "SZL", "EGP"];

  private config: MobileMoneyConfig | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  async initialize(config: MobileMoneyConfig): Promise<void> {
    this.config = config;
    await this.authenticate();
  }

  private async authenticate(): Promise<void> {
    if (!this.config?.consumerKey || !this.config?.consumerSecret) {
      throw new Error("M-Pesa credentials not configured");
    }

    try {
      const baseUrl = this.config.environment === "production" 
        ? "https://api.safaricom.co.ke" 
        : "https://sandbox.safaricom.co.ke";

      const res = await mobileMoneyRequest<{ access_token?: string; expires_in?: number }>({
        url: `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        method: "GET",
        headers: {
          "Authorization": `Basic ${Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString("base64")}`,
        },
      });

      const data = res.data;
      this.accessToken = data.access_token ?? null;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000);
    } catch (error) {
      console.error("[MPesa] Authentication failed:", error);
      throw error;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (!this.accessToken || (this.tokenExpiry && this.tokenExpiry <= new Date())) {
      await this.authenticate();
    }
    return this.accessToken!;
  }

  private generatePassword(): string {
    if (!this.config?.businessShortCode || !this.config?.passKey) {
      throw new Error("M-Pesa business short code and pass key required");
    }
    const timestamp = this.getPasswordTimestamp();
    const data = this.config.businessShortCode + this.config.passKey + timestamp;
    return Buffer.from(data).toString("base64");
  }

  private getPasswordTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
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
        ? "https://api.safaricom.co.ke" 
        : "https://sandbox.safaricom.co.ke";

      const accessToken = await this.getAccessToken();
      const password = this.generatePassword();
      
      const res = await mobileMoneyRequest<{ CheckoutRequestID?: string; errorCode?: string; errorMessage?: string }>({
        url: `${baseUrl}/mpesa/stkpush/v1/processrequest`,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: {
          BusinessShortCode: this.config.businessShortCode,
          Password: password,
          Timestamp: this.getPasswordTimestamp(),
          TransactionType: "CustomerPayBillOnline",
          Amount: Math.round(input.amountMinor / 100),
          PartyA: input.phoneNumber.replace("+", ""),
          PartyB: this.config.businessShortCode,
          PhoneNumber: input.phoneNumber.replace("+", ""),
          CallBackURL: this.config.webhookUrl || "",
          AccountReference: input.reference,
          TransactionDesc: input.description || "Payment to TurboPay",
        },
      });

      const data = res.data;

      return {
        ok: true,
        data: {
          providerRef: data.CheckoutRequestID || input.reference,
          status: "PENDING",
          amountMinor: input.amountMinor,
          currency: input.currency,
          phoneNumber: input.phoneNumber,
          transactionDate: new Date(),
        },
        providerRef: data.CheckoutRequestID || input.reference,
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
        ? "https://api.safaricom.co.ke" 
        : "https://sandbox.safaricom.co.ke";

      const accessToken = await this.getAccessToken();
      const password = this.generatePassword();
      
      const res = await mobileMoneyRequest<{ ConversationID?: string; errorCode?: string; errorMessage?: string }>({
        url: `${baseUrl}/mpesa/b2c/v1/paymentrequest`,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: {
          InitiatorName: "turbopay",
          SecurityCredential: password,
          CommandID: "BusinessPayment",
          Amount: Math.round(input.amountMinor / 100),
          PartyA: this.config.businessShortCode,
          PartyB: input.phoneNumber.replace("+", ""),
          Remarks: input.description || "Transfer from TurboPay",
          QueueTimeOutURL: this.config.webhookUrl || "",
          ResultURL: this.config.webhookUrl || "",
          Occasion: input.reference,
        },
      });

      const data = res.data;

      return {
        ok: true,
        data: {
          providerRef: data.ConversationID || input.reference,
          status: "PENDING",
          amountMinor: input.amountMinor,
          currency: input.currency,
          phoneNumber: input.phoneNumber,
          transactionDate: new Date(),
        },
        providerRef: data.ConversationID || input.reference,
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
        ? "https://api.safaricom.co.ke" 
        : "https://sandbox.safaricom.co.ke";

      const accessToken = await this.getAccessToken();
      
      const res = await mobileMoneyRequest<{ ResponseCode?: string }>({
        url: `${baseUrl}/mpesa/transactionstatus/v1/query`,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: {
          Initiator: "turbopay",
          SecurityCredential: this.generatePassword(),
          CommandID: "TransactionStatusQuery",
          TransactionID: providerRef,
          OriginatorConversationID: providerRef,
        },
      });

      const data = res.data;
      const status = this.mapStatus(data.ResponseCode ?? "");

      return {
        ok: true,
        data: {
          providerRef,
          status,
          amountMinor: 0,
          currency: this.config.currency,
          phoneNumber: "",
          transactionDate: new Date(),
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
        ? "https://api.safaricom.co.ke" 
        : "https://sandbox.safaricom.co.ke";

      const accessToken = await this.getAccessToken();
      
      const res = await mobileMoneyRequest<Record<string, unknown>>({
        url: `${baseUrl}/mpesa/accountbalance/v1/query`,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: {
          Initiator: "turbopay",
          SecurityCredential: this.generatePassword(),
          CommandID: "AccountBalance",
        },
      });

      const data = res.data;

      return {
        ok: true,
        data: {
          balance: 0,
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
    const country = this.config?.country || "KE";
    const formats: Record<string, RegExp> = {
      KE: /^(\+254|254|0)[17]\d{8}$/,
      TZ: /^(\+255|255|0)[67]\d{8}$/,
    };
    const format = formats[country] || /^\+?\d{10,15}$/;
    return format.test(phone);
  }

  private mapStatus(code: string): MobileMoneyResult["status"] {
    const statusMap: Record<string, MobileMoneyResult["status"]> = {
      "0": "SUCCESS",
      "1032": "FAILED",
      "1037": "FAILED",
      "1": "FAILED",
    };
    return statusMap[code] || "PENDING";
  }
}

export default MPesaAdapter;
