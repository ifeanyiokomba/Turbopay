// TurboPay Mobile Money Smoke Test
// Quick validation that all 5 mobile money providers integrate correctly
// with the existing provider selection, routing, and ledger systems

import { ProviderSelectionEngine } from '../services/provider-selection-engine';
import { ProviderRegistry } from '../services/provider-wrapper';
import { ProviderRouter } from '../services/provider-router';
import { LedgerService } from '../services/ledger';
import { CapabilityEngine } from '../services/capability-engine';
import { HealthMonitor } from '../services/health-monitor';
import { WebhookHandler } from '../services/webhook-handler';
import { MobileMoneyOrchestrator } from '../services/mobile-money-orchestrator';
import { FundingWorkflowService } from '../services/funding-workflow';
import { OTPService } from '../services/otp-service';
import { ComplianceService } from '../services/compliance-service';

// Import adapters
import { SmartCashAdapter } from '../adapters/smartcash.adapter';
import { AirtelMoneyAdapter } from '../adapters/airtel-money.adapter';
import { MTNMoMoAdapter } from '../adapters/mtn-momo.adapter';
import { MPesaAdapter } from '../adapters/mpesa.adapter';
import { PagaAdapter } from '../adapters/paga.adapter';

import { ProviderName } from '../types';

// =============================================================================
// TEST HELPERS
// =============================================================================

function createMockConfig() {
  const env = 'sandbox' as const;
  return {
    smartcash: { client_id: 'test', client_secret: 'test', environment: env },
    airtel_money: { client_id: 'test', client_secret: 'test', environment: env },
    mtn_momo: { api_key: 'test', api_secret: 'test', subscription_key: 'test', environment: env },
    mpesa: { consumer_key: 'test', consumer_secret: 'test', shortcode: '174379', passkey: 'test', environment: env },
    paga: { principal: 'test', credentials: 'test', hash_key: 'test', environment: env },
  };
}

// =============================================================================
// SMOKE TESTS
// =============================================================================

describe('Mobile Money Smoke Tests', () => {
  let selectionEngine: ProviderSelectionEngine;
  let registry: ProviderRegistry;
  let router: ProviderRouter;
  let ledger: LedgerService;
  let mobileMoney: MobileMoneyOrchestrator;
  let fundingWorkflow: FundingWorkflowService;
  let otp: OTPService;
  let compliance: ComplianceService;

  beforeEach(() => {
    selectionEngine = new ProviderSelectionEngine();
    registry = new ProviderRegistry();
    router = new ProviderRouter();
    ledger = new LedgerService();
    otp = new OTPService({ api_key: 'test', sender_id: 'test' });
    compliance = new ComplianceService();
  });

  // ===========================================================================
  // 1. ADAPTER INSTANTIATION
  // ===========================================================================

  describe('Adapter Instantiation', () => {
    test('SmartCash adapter creates successfully', () => {
      const adapter = new SmartCashAdapter(createMockConfig().smartcash);
      expect(adapter.name).toBe('smartcash');
      expect(adapter.displayName).toBe('Smart Cash');
    });

    test('Airtel Money adapter creates successfully', () => {
      const adapter = new AirtelMoneyAdapter(createMockConfig().airtel_money);
      expect(adapter.name).toBe('airtel_money');
      expect(adapter.displayName).toBe('Airtel Money');
    });

    test('MTN MoMo adapter creates successfully', () => {
      const adapter = new MTNMoMoAdapter(createMockConfig().mtn_momo);
      expect(adapter.name).toBe('mtn_momo');
      expect(adapter.displayName).toBe('MTN MoMo');
    });

    test('M-Pesa adapter creates successfully', () => {
      const adapter = new MPesaAdapter(createMockConfig().mpesa);
      expect(adapter.name).toBe('mpesa');
      expect(adapter.displayName).toBe('M-Pesa');
    });

    test('Paga adapter creates successfully', () => {
      const adapter = new PagaAdapter(createMockConfig().paga);
      expect(adapter.name).toBe('paga');
      expect(adapter.displayName).toBe('Paga');
    });
  });

  // ===========================================================================
  // 2. CAPABILITIES
  // ===========================================================================

  describe('Capabilities', () => {
    test('SmartCash: Nigeria only, mobile money collections + payouts', () => {
      const adapter = new SmartCashAdapter(createMockConfig().smartcash);
      const caps = adapter.getCapabilities();
      expect(caps.countries).toEqual(['NG']);
      expect(caps.currencies).toEqual(['NGN']);
      expect(caps.collections.mobile_money).toBe(true);
      expect(caps.payouts.mobile_money).toBe(true);
    });

    test('Airtel Money: Multi-country, excludes Nigeria', () => {
      const adapter = new AirtelMoneyAdapter(createMockConfig().airtel_money);
      const caps = adapter.getCapabilities();
      expect(caps.countries).not.toContain('NG');
      expect(caps.countries).toContain('KE');
      expect(caps.countries).toContain('TZ');
      expect(caps.collections.mobile_money).toBe(true);
      expect(caps.payouts.mobile_money).toBe(true);
    });

    test('MTN MoMo: Multi-country including Nigeria', () => {
      const adapter = new MTNMoMoAdapter(createMockConfig().mtn_momo);
      const caps = adapter.getCapabilities();
      expect(caps.countries).toContain('NG');
      expect(caps.countries).toContain('GH');
      expect(caps.collections.mobile_money).toBe(true);
      expect(caps.payouts.mobile_money).toBe(true);
    });

    test('M-Pesa: Kenya primarily', () => {
      const adapter = new MPesaAdapter(createMockConfig().mpesa);
      const caps = adapter.getCapabilities();
      expect(caps.countries).toEqual(['KE']);
      expect(caps.currencies).toEqual(['KES']);
      expect(caps.collections.mobile_money).toBe(true);
      expect(caps.payouts.mobile_money).toBe(true);
    });

    test('Paga: Nigeria only, bank + mobile money', () => {
      const adapter = new PagaAdapter(createMockConfig().paga);
      const caps = adapter.getCapabilities();
      expect(caps.countries).toEqual(['NG']);
      expect(caps.collections.mobile_money).toBe(true);
      expect(caps.payouts.mobile_money).toBe(true);
      expect(caps.payouts.bank_transfer).toBe(true);
    });
  });

  // ===========================================================================
  // 3. PROVIDER REGISTRATION & SELECTION
  // ===========================================================================

  describe('Provider Registration & Selection', () => {
    test('All 5 providers register into capability engine', () => {
      const adapters = [
        new SmartCashAdapter(createMockConfig().smartcash),
        new AirtelMoneyAdapter(createMockConfig().airtel_money),
        new MTNMoMoAdapter(createMockConfig().mtn_momo),
        new MPesaAdapter(createMockConfig().mpesa),
        new PagaAdapter(createMockConfig().paga),
      ];

      for (const adapter of adapters) {
        selectionEngine.registerProvider(adapter.name, adapter.getCapabilities());
      }

      const allProviders = selectionEngine.getAllHealthData();
      expect(allProviders.has('smartcash')).toBe(true);
      expect(allProviders.has('airtel_money')).toBe(true);
      expect(allProviders.has('mtn_momo')).toBe(true);
      expect(allProviders.has('mpesa')).toBe(true);
      expect(allProviders.has('paga')).toBe(true);
    });

    test('Capability engine finds providers by country + operation', () => {
      const caps = new CapabilityEngine();
      caps.register('smartcash', new SmartCashAdapter(createMockConfig().smartcash).getCapabilities());
      caps.register('mtn_momo', new MTNMoMoAdapter(createMockConfig().mtn_momo).getCapabilities());
      caps.register('mpesa', new MPesaAdapter(createMockConfig().mpesa).getCapabilities());

      // Nigeria: should find SmartCash and MTN MoMo
      const ngProviders = caps.getProvidersWithCapability('mobile_money_collection', 'NG', 'NGN');
      expect(ngProviders).toContain('smartcash');
      expect(ngProviders).toContain('mtn_momo');
      expect(ngProviders).not.toContain('mpesa');

      // Kenya: should find M-Pesa (MTN MoMo has no KES in currencies)
      const keProviders = caps.getProvidersWithCapability('mobile_money_collection', 'KE', 'KES');
      expect(keProviders).toContain('mpesa');
      expect(keProviders).not.toContain('smartcash');
    });

    test('Selection engine scores providers for Nigeria collection', () => {
      const adapters = [
        new SmartCashAdapter(createMockConfig().smartcash),
        new MTNMoMoAdapter(createMockConfig().mtn_momo),
      ];

      for (const adapter of adapters) {
        selectionEngine.registerProvider(adapter.name, adapter.getCapabilities());
        registry.register(adapter);
      }

      const best = selectionEngine.selectBestProvider('mobile_money_collection', 'NG', 'NGN', 5000);
      expect(best).not.toBeNull();
      expect(['smartcash', 'mtn_momo']).toContain(best!.provider);
    });

    test('Failover chain includes multiple providers', () => {
      const adapters = [
        new SmartCashAdapter(createMockConfig().smartcash),
        new AirtelMoneyAdapter(createMockConfig().airtel_money),
        new MTNMoMoAdapter(createMockConfig().mtn_momo),
        new MPesaAdapter(createMockConfig().mpesa),
        new PagaAdapter(createMockConfig().paga),
      ];

      for (const adapter of adapters) {
        selectionEngine.registerProvider(adapter.name, adapter.getCapabilities());
      }

      const chain = selectionEngine.getFailoverChain('mobile_money_collection', 'NG', 'NGN', 1000);
      expect(chain.length).toBeGreaterThan(0);
      // SmartCash and MTN MoMo and Paga support NG
      const providerNames = chain.map(s => s.provider);
      expect(providerNames).toContain('smartcash');
    });
  });

  // ===========================================================================
  // 4. FEE CALCULATIONS
  // ===========================================================================

  describe('Fee Calculations', () => {
    test('Router has fee entries for all 5 new providers', () => {
      const providers: ProviderName[] = ['smartcash', 'airtel_money', 'mtn_momo', 'mpesa', 'paga'];
      for (const p of providers) {
        const fees = router.getProviderFees(p);
        expect(fees).toBeDefined();
        expect(fees.collection_fee_percent).toBeGreaterThanOrEqual(0);
        expect(fees.transfer_fee_flat).toBeGreaterThanOrEqual(0);
      }
    });

    test('Fee calculation works for each provider', () => {
      const providers: ProviderName[] = ['smartcash', 'airtel_money', 'mtn_momo', 'mpesa', 'paga'];
      for (const p of providers) {
        const fee = router.calculateFee(p, 'mobile_money_collection', 10000);
        expect(fee).toBeGreaterThan(0);
        expect(fee).toBeLessThan(10000);
      }
    });
  });

  // ===========================================================================
  // 5. MOBILE MONEY ORCHESTRATOR
  // ===========================================================================

  describe('Mobile Money Orchestrator', () => {
    test('Supported countries are configured', () => {
      const adapters = [
        new SmartCashAdapter(createMockConfig().smartcash),
        new MTNMoMoAdapter(createMockConfig().mtn_momo),
        new MPesaAdapter(createMockConfig().mpesa),
        new PagaAdapter(createMockConfig().paga),
      ];

      for (const adapter of adapters) {
        selectionEngine.registerProvider(adapter.name, adapter.getCapabilities());
        registry.register(adapter);
      }

      mobileMoney = new MobileMoneyOrchestrator(selectionEngine, registry, ledger, new WebhookHandler(router));

      const countries = mobileMoney.getSupportedCountries();
      expect(countries.length).toBeGreaterThan(0);

      const ngConfig = mobileMoney.getCountryConfig('NG');
      expect(ngConfig).toBeDefined();
      // NG config has paystack/flutterwave/monnify; smartcash is a separate adapter registered independently
      expect(ngConfig!.providers.length).toBeGreaterThan(0);
    });

    test('Operation support is checked correctly', () => {
      const adapter = new SmartCashAdapter(createMockConfig().smartcash);
      selectionEngine.registerProvider('smartcash', adapter.getCapabilities());
      registry.register(adapter);

      mobileMoney = new MobileMoneyOrchestrator(selectionEngine, registry, ledger, new WebhookHandler(router));

      expect(mobileMoney.isOperationSupported('NG', 'collection')).toBe(true);
      expect(mobileMoney.isOperationSupported('NG', 'disbursement')).toBe(true);
    });
  });

  // ===========================================================================
  // 6. OTP SERVICE
  // ===========================================================================

  describe('OTP Service', () => {
    test('OTP service initializes with templates', () => {
      otp = new OTPService({ api_key: 'test', sender_id: 'test' });
      const templates = otp.getAllTemplates();
      expect(templates.registration).toBeDefined();
      expect(templates.password_reset).toBeDefined();
      expect(templates.login).toBeDefined();
      expect(templates.transaction_confirmation).toBeDefined();
    });

    test('OTP stats work', () => {
      otp = new OTPService({ api_key: 'test', sender_id: 'test' });
      const stats = otp.getOTPStats();
      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
    });
  });

  // ===========================================================================
  // 7. COMPLIANCE SERVICE
  // ===========================================================================

  describe('Compliance Service', () => {
    test('Compliance service initializes with defaults', () => {
      compliance = new ComplianceService();
      const data = compliance.getHomepageTrustData();
      expect(data.indicators.length).toBeGreaterThan(0);
      expect(data.security_badges.length).toBeGreaterThan(0);
      expect(data.provider_logos.length).toBeGreaterThan(0);
    });

    test('PCI DSS badge is hidden by default', () => {
      compliance = new ComplianceService();
      expect(compliance.isPCICompliant()).toBe(false);
      expect(compliance.getPaymentSecurityNotice()).toContain('PCI DSS compliant payment partners');
    });

    test('Provider logos include all 10 providers', () => {
      compliance = new ComplianceService();
      const logos = compliance.getActiveProviderLogos();
      expect(logos.length).toBe(10);
      const names = logos.map(l => l.provider_name);
      expect(names).toContain('mtn_momo');
      expect(names).toContain('airtel_money');
      expect(names).toContain('mpesa');
    });
  });

  // ===========================================================================
  // 8. LEDGER INTEGRATION
  // ===========================================================================

  describe('Ledger Integration', () => {
    test('Wallet creation and credit/debit cycle works', async () => {
      const wallet = ledger.createWallet('user_1', 'NGN');
      expect(wallet.id).toBeDefined();
      expect(wallet.balance).toBe(0);

      const credit = await ledger.credit(wallet.id, 50000, 'NGN', 'ref_001', 'mtn_momo', undefined, 'Funding via MTN MoMo');
      expect(credit.type).toBe('credit');
      expect(credit.amount).toBe(50000);

      const balance = ledger.getWalletBalance(wallet.id);
      expect(balance!.balance).toBe(50000);

      const debit = await ledger.debit(wallet.id, 10000, 'NGN', 'ref_002', undefined, undefined, 'Disbursement');
      expect(debit.type).toBe('debit');

      const finalBalance = ledger.getWalletBalance(wallet.id);
      expect(finalBalance!.balance).toBe(40000);
    });
  });
});
