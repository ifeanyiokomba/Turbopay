/**
 * TurboCore — Mobile Money Service
 * =================================
 *
 * Unified Mobile Money service that handles collections and disbursements
 * across multiple providers (MTN MoMo, Airtel Money, M-Pesa, Paga).
 *
 * Features:
 * - Smart provider selection based on country
 * - Automatic failover between providers
 * - Cost optimization
 * - Real-time status tracking
 */

import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { encryptPii } from "@/lib/turbopay/crypto";
import type {
  IMobileMoneyProvider,
  MobileMoneyCollectionInput,
  MobileMoneyDisbursementInput,
  MobileMoneyResult,
  MobileMoneyProvider,
  MobileMoneyCountryConfig,
} from "@/lib/turbocore/providers/interfaces/mobile-money";
import { getMobileMoneyCountryConfig, getProviderPriority } from "@/lib/turbocore/providers/interfaces/mobile-money";
import { MtnMomoAdapter } from "@/lib/turbocore/providers/adapters/mtn-momo";
import { AirtelMoneyAdapter } from "@/lib/turbocore/providers/adapters/airtel-money";
import { MPesaAdapter } from "@/lib/turbocore/providers/adapters/m-pesa";
import { PagaAdapter } from "@/lib/turbocore/providers/adapters/paga";

// ─── Types ───────────────────────────────────────────────────

export interface MobileMoneyServiceConfig {
  /** Default timeout for provider calls (ms). */
  timeoutMs?: number;
  /** Maximum retry attempts. */
  maxRetries?: number;
  /** Enable automatic failover. */
  enableFailover?: boolean;
}

export interface MobileMoneyTransaction {
  id: string;
  userId: string;
  provider: MobileMoneyProvider;
  type: "collection" | "disbursement";
  phoneNumber: string;
  amountMinor: number;
  currency: string;
  country: string;
  reference: string;
  status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "REVERSED";
  providerRef?: string;
  errorMessage?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Service ─────────────────────────────────────────────────

export class MobileMoneyService {
  private providers: Map<MobileMoneyProvider, IMobileMoneyProvider> = new Map();
  private config: MobileMoneyServiceConfig;

  constructor(config: MobileMoneyServiceConfig = {}) {
    this.config = {
      timeoutMs: 30000,
      maxRetries: 3,
      enableFailover: true,
      ...config,
    };
  }

  /**
   * Initialize a Mobile Money provider with credentials.
   */
  async initializeProvider(
    provider: MobileMoneyProvider,
    config: any
  ): Promise<void> {
    let adapter: IMobileMoneyProvider;

    switch (provider) {
      case "mtn-momo":
        adapter = new MtnMomoAdapter();
        break;
      case "airtel-money":
        adapter = new AirtelMoneyAdapter();
        break;
      case "m-pesa":
        adapter = new MPesaAdapter();
        break;
      case "paga":
        adapter = new PagaAdapter();
        break;
      default:
        throw new Error(`Unknown Mobile Money provider: ${provider}`);
    }

    await adapter.initialize(config);
    this.providers.set(provider, adapter);
    
    console.log(`[MobileMoney] Initialized ${adapter.displayName}`);
  }

  /**
   * Get available providers for a country.
   */
  getAvailableProviders(country: string): MobileMoneyProvider[] {
    const countryConfig = getMobileMoneyCountryConfig(country);
    if (!countryConfig) {
      return [];
    }

    // Filter to only initialized providers
    return countryConfig.priorityOrder.filter(p => this.providers.has(p));
  }

  /**
   * Select the best provider for a transaction.
   */
  selectProvider(
    country: string,
    operation: "collection" | "disbursement",
    preferredProvider?: MobileMoneyProvider
  ): IMobileMoneyProvider | null {
    // If preferred provider is specified and available, use it
    if (preferredProvider && this.providers.has(preferredProvider)) {
      const provider = this.providers.get(preferredProvider)!;
      const countryConfig = getMobileMoneyCountryConfig(country);
      if (countryConfig?.providers.includes(preferredProvider)) {
        return provider;
      }
    }

    // Get provider priority for this country
    const priorityOrder = getProviderPriority(country);
    
    // Select first available provider
    for (const providerName of priorityOrder) {
      if (this.providers.has(providerName)) {
        return this.providers.get(providerName)!;
      }
    }

    return null;
  }

  /**
   * Initiate a collection (receive money).
   */
  async collect(
    input: MobileMoneyCollectionInput,
    userId: string,
    preferredProvider?: MobileMoneyProvider
  ): Promise<{ success: boolean; transaction?: MobileMoneyTransaction; error?: string }> {
    const provider = this.selectProvider(input.country, "collection", preferredProvider);
    
    if (!provider) {
      return {
        success: false,
        error: `No Mobile Money provider available for ${input.country}`,
      };
    }

    // Create transaction record
    const transaction = await this.createTransaction({
      userId,
      provider: provider.name,
      type: "collection",
      phoneNumber: input.phoneNumber,
      amountMinor: input.amountMinor,
      currency: input.currency,
      country: input.country,
      reference: input.reference,
      status: "PENDING",
    });

    try {
      // Execute collection
      const result = await provider.collect(input);

      if (result.ok && result.data) {
        // Update transaction with provider reference
        await this.updateTransaction(transaction.id, {
          status: "PROCESSING",
          providerRef: result.data.providerRef,
        });

        // Audit log
        await audit({
          action: "MOBILE_MONEY_COLLECTION_INITIATED",
          category: "MOBILE_MONEY",
          userId,
          metadata: {
            provider: provider.name,
            phoneNumber: input.phoneNumber,
            amountMinor: input.amountMinor,
            reference: input.reference,
          },
        });

        return {
          success: true,
          transaction: await this.getTransaction(transaction.id),
        };
      } else {
        // Update transaction as failed
        await this.updateTransaction(transaction.id, {
          status: "FAILED",
          errorMessage: result.error?.message || "Collection failed",
        });

        return {
          success: false,
          error: result.error?.message || "Collection failed",
        };
      }
    } catch (error) {
      // Update transaction as failed
      await this.updateTransaction(transaction.id, {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Collection failed",
      };
    }
  }

  /**
   * Initiate a disbursement (send money).
   */
  async disburse(
    input: MobileMoneyDisbursementInput,
    userId: string,
    preferredProvider?: MobileMoneyProvider
  ): Promise<{ success: boolean; transaction?: MobileMoneyTransaction; error?: string }> {
    const provider = this.selectProvider(input.country, "disbursement", preferredProvider);
    
    if (!provider) {
      return {
        success: false,
        error: `No Mobile Money provider available for ${input.country}`,
      };
    }

    // Create transaction record
    const transaction = await this.createTransaction({
      userId,
      provider: provider.name,
      type: "disbursement",
      phoneNumber: input.phoneNumber,
      amountMinor: input.amountMinor,
      currency: input.currency,
      country: input.country,
      reference: input.reference,
      status: "PENDING",
    });

    try {
      // Execute disbursement
      const result = await provider.disburse(input);

      if (result.ok && result.data) {
        // Update transaction with provider reference
        await this.updateTransaction(transaction.id, {
          status: "PROCESSING",
          providerRef: result.data.providerRef,
        });

        // Audit log
        await audit({
          action: "MOBILE_MONEY_DISBURSEMENT_INITIATED",
          category: "MOBILE_MONEY",
          userId,
          metadata: {
            provider: provider.name,
            phoneNumber: input.phoneNumber,
            amountMinor: input.amountMinor,
            reference: input.reference,
          },
        });

        return {
          success: true,
          transaction: await this.getTransaction(transaction.id),
        };
      } else {
        // Update transaction as failed
        await this.updateTransaction(transaction.id, {
          status: "FAILED",
          errorMessage: result.error?.message || "Disbursement failed",
        });

        return {
          success: false,
          error: result.error?.message || "Disbursement failed",
        };
      }
    } catch (error) {
      // Update transaction as failed
      await this.updateTransaction(transaction.id, {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Disbursement failed",
      };
    }
  }

  /**
   * Check transaction status.
   */
  async checkStatus(transactionId: string): Promise<{ success: boolean; status?: string; error?: string }> {
    const transaction = await this.getTransaction(transactionId);
    
    if (!transaction) {
      return { success: false, error: "Transaction not found" };
    }

    const provider = this.providers.get(transaction.provider);
    if (!provider) {
      return { success: false, error: "Provider not available" };
    }

    try {
      const result = await provider.checkStatus(transaction.providerRef || transaction.reference);

      if (result.ok && result.data) {
        await this.updateTransaction(transactionId, {
          status: result.data.status,
        });

        return {
          success: true,
          status: result.data.status,
        };
      } else {
        return {
          success: false,
          error: result.error?.message || "Status check failed",
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Status check failed",
      };
    }
  }

  /**
   * Get provider health status.
   */
  async getProviderHealth(): Promise<Record<MobileMoneyProvider, { healthy: boolean; latencyMs?: number }>> {
    const health: Record<string, { healthy: boolean; latencyMs?: number }> = {};

    for (const [name, provider] of this.providers) {
      health[name] = await provider.healthCheck();
    }

    return health as Record<MobileMoneyProvider, { healthy: boolean; latencyMs?: number }>;
  }

  /**
   * Validate phone number for a specific provider.
   */
  validatePhoneNumber(phone: string, provider: MobileMoneyProvider): boolean {
    const adapter = this.providers.get(provider);
    if (!adapter) {
      return false;
    }
    return adapter.validatePhoneNumber(phone);
  }

  // ─── Private Helpers ───────────────────────────────────────

  private async createTransaction(data: {
    userId: string;
    provider: MobileMoneyProvider;
    type: "collection" | "disbursement";
    phoneNumber: string;
    amountMinor: number;
    currency: string;
    country: string;
    reference: string;
    status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "REVERSED";
  }): Promise<MobileMoneyTransaction> {
    const transaction = await db.mobileMoneyTransaction.create({
      data: {
        userId: data.userId,
        provider: data.provider,
        type: data.type,
        phoneNumber: data.phoneNumber,
        amountMinor: data.amountMinor,
        currency: data.currency,
        country: data.country,
        reference: data.reference,
        status: data.status,
      },
    });

    return transaction as MobileMoneyTransaction;
  }

  private async updateTransaction(
    id: string,
    data: Partial<MobileMoneyTransaction>
  ): Promise<void> {
    await db.mobileMoneyTransaction.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  private async getTransaction(id: string): Promise<MobileMoneyTransaction | null> {
    const transaction = await db.mobileMoneyTransaction.findUnique({
      where: { id },
    });

    return transaction as MobileMoneyTransaction | null;
  }
}

// ─── Singleton ───────────────────────────────────────────────

let mobileMoneyService: MobileMoneyService | null = null;

export function getMobileMoneyService(): MobileMoneyService {
  if (!mobileMoneyService) {
    mobileMoneyService = new MobileMoneyService();
  }
  return mobileMoneyService;
}

export default MobileMoneyService;
