// TurboPay Capability Engine
// Dynamic discovery of provider capabilities

import {
  ProviderName,
  ProviderCapabilities,
  PaymentOperation
} from '../types';

// =============================================================================
// CAPABILITY ENGINE
// =============================================================================

export class CapabilityEngine {
  private capabilities: Map<ProviderName, ProviderCapabilities> = new Map();

  /**
   * Register provider capabilities
   */
  register(provider: ProviderName, capabilities: ProviderCapabilities): void {
    this.capabilities.set(provider, capabilities);
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(provider: ProviderName): ProviderCapabilities | undefined {
    return this.capabilities.get(provider);
  }

  /**
   * Get all registered capabilities
   */
  getAllCapabilities(): Map<ProviderName, ProviderCapabilities> {
    return this.capabilities;
  }

  /**
   * Check if provider has specific capability
   */
  hasCapability(provider: ProviderName, capability: PaymentOperation): boolean {
    const caps = this.capabilities.get(provider);
    if (!caps) return false;

    return this.checkCapability(caps, capability);
  }

  /**
   * Get all providers with specific capability
   */
  getProvidersWithCapability(
    capability: PaymentOperation,
    country?: string,
    currency?: string
  ): ProviderName[] {
    const providers: ProviderName[] = [];

    for (const [provider, caps] of this.capabilities) {
      if (!this.checkCapability(caps, capability)) {
        continue;
      }

      // Check country support if specified
      if (country && caps.countries.length > 0) {
        if (!caps.countries.includes(country)) {
          continue;
        }
      }

      // Check currency support if specified
      if (currency && caps.currencies.length > 0) {
        if (!caps.currencies.includes(currency)) {
          continue;
        }
      }

      providers.push(provider);
    }

    return providers;
  }

  /**
   * Get feature match score (0-1)
   */
  getFeatureMatch(provider: ProviderName, capability: PaymentOperation): number {
    return this.hasCapability(provider, capability) ? 1 : 0;
  }

  /**
   * Get best provider for capability
   */
  getBestProvider(
    capability: PaymentOperation,
    country?: string,
    currency?: string,
    preferredProvider?: ProviderName
  ): ProviderName | null {
    // If preferred provider is specified and capable, return it
    if (preferredProvider && this.hasCapability(preferredProvider, capability)) {
      const caps = this.capabilities.get(preferredProvider)!;
      if (country && !caps.countries.includes(country)) {
        return null;
      }
      if (currency && !caps.currencies.includes(currency)) {
        return null;
      }
      return preferredProvider;
    }

    // Get all capable providers
    const providers = this.getProvidersWithCapability(capability, country, currency);
    return providers.length > 0 ? providers[0] : null;
  }

  /**
   * Check capability based on operation type
   */
  private checkCapability(caps: ProviderCapabilities, operation: PaymentOperation): boolean {
    switch (operation) {
      // Collections
      case 'card_collection':
        return caps.collections.card;
      case 'bank_transfer_collection':
        return caps.collections.bank_transfer;
      case 'ussd_collection':
        return caps.collections.ussd;
      case 'mobile_money_collection':
        return caps.collections.mobile_money;
      case 'qr_collection':
        return caps.collections.qr;

      // Payouts
      case 'bank_transfer_payout':
        return caps.payouts.bank_transfer;
      case 'mobile_money_payout':
        return caps.payouts.mobile_money;
      case 'bulk_payment':
        return caps.payouts.bulk;

      // Virtual Accounts
      case 'virtual_account':
        return caps.virtual_accounts.dedicated ||
               caps.virtual_accounts.dynamic ||
               caps.virtual_accounts.static;

      // Bills
      case 'bill_payment':
        return caps.bills.airtime || caps.bills.data || caps.bills.electricity ||
               caps.bills.cable_tv || caps.bills.education;
      case 'airtime':
        return caps.bills.airtime;
      case 'data':
        return caps.bills.data;
      case 'electricity':
        return caps.bills.electricity;
      case 'cable_tv':
        return caps.bills.cable_tv;
      case 'education':
        return caps.bills.education;

      // Refund / Reversal
      case 'refund':
        return caps.technical.refunds;
      case 'reversal':
        return caps.technical.reversals;

      // International / FX
      case 'papss':
        return caps.technical.international;
      case 'fx':
        return caps.technical.multi_currency;

      // Merchant collection
      case 'merchant_collection':
        return caps.collections.bank_transfer || caps.collections.card;

      // Bank resolution / KYC
      case 'bank_resolution':
        return caps.collections.bank_transfer;
      case 'bvn':
        return caps.customers.bvn;
      case 'kyc':
        return caps.customers.kyc;

      // Mobile money (general)
      case 'mobile_money':
        return caps.collections.mobile_money || caps.payouts.mobile_money;

      default:
        return false;
    }
  }

  /**
   * Get capability summary for all providers
   */
  getSummary(): Record<PaymentOperation, ProviderName[]> {
    const operations: PaymentOperation[] = [
      'card_collection',
      'bank_transfer_collection',
      'ussd_collection',
      'mobile_money_collection',
      'qr_collection',
      'bank_transfer_payout',
      'mobile_money_payout',
      'bulk_payment',
      'virtual_account',
      'airtime',
      'data',
      'electricity',
      'cable_tv',
      'education',
      'refund',
      'reversal',
      'papss',
      'fx',
      'bank_resolution',
      'bvn',
      'kyc',
      'mobile_money',
      'merchant_collection'
    ];

    const summary: Record<PaymentOperation, ProviderName[]> = {} as any;

    for (const operation of operations) {
      summary[operation] = this.getProvidersWithCapability(operation);
    }

    return summary;
  }
}

export default CapabilityEngine;
