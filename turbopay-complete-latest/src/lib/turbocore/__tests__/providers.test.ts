import { describe, it, expect } from "vitest";
import { providers } from "@/lib/turbocore/providers/registry";
import {
  MockVirtualAccountProvider,
  MockBillPaymentProvider,
  MockKYCProvider,
  MockNotificationProvider,
  MockExchangeRateProvider,
  MockInternationalReceivingProvider,
} from "@/lib/turbocore/providers/mock";

/**
 * Provider adapter tests — verify each contract returns the expected
 * normalised domain types. These test the MOCK adapters directly (not
 * through the registry, which may resolve to a DB-configured production
 * adapter when Monnify/Paystack sandbox keys are present). The same
 * assertions hold against production adapters once registered.
 */

describe("Provider Framework", () => {
  it("mock adapters expose the expected names", () => {
    const va = new MockVirtualAccountProvider();
    const bp = new MockBillPaymentProvider();
    const kyc = new MockKYCProvider();
    const notif = new MockNotificationProvider();
    const fx = new MockExchangeRateProvider();
    expect(va.name).toBe("mock-virtual-account");
    expect(bp.name).toBe("mock-bill-payment");
    expect(kyc.name).toBe("mock-kyc");
    expect(notif.name).toBe("mock-notification");
    expect(fx.name).toBe("mock-fx");
  });

  it("IVirtualAccountProvider.createReservedAccount returns normalised details", async () => {
    const va = new MockVirtualAccountProvider();
    const result = await va.createReservedAccount("John Doe", "user_123");
    expect(result.ok).toBe(true);
    expect(result.data!.accountNumber).toMatch(/^\d{10}$/);
    expect(result.data!.accountName).toBe("John Doe");
    expect(result.data!.currency).toBe("NGN");
    expect(result.providerRef).toBeTruthy();
  });

  it("IKYCProvider.verifyNin returns normalised identity", async () => {
    const kyc = await providers.kyc();
    const result = await kyc.verifyNin("12345678901");
    expect(result.ok).toBe(true);
    expect(result.data!.verified).toBe(true);
    expect(result.data!.firstName).toBeTruthy();
    expect(result.data!.lastName).toBeTruthy();
    expect(result.data!.providerRef).toMatch(/^MOCK-NIN-/);
  });

  it("IKYCProvider.verifyNin rejects invalid NIN", async () => {
    const kyc = await providers.kyc();
    const result = await kyc.verifyNin("123");
    expect(result.ok).toBe(true);
    expect(result.data!.verified).toBe(false);
  });

  it("IBillPaymentProvider.listProducts returns catalog", async () => {
    const bp = await providers.billPayment();
    const result = await bp.listProducts();
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBeGreaterThan(0);
    expect(result.data![0].code).toBeTruthy();
    expect(result.data![0].category).toBeTruthy();
  });

  it("IBillPaymentProvider.validate + pay round-trips", async () => {
    const bp = await providers.billPayment();
    const validate = await bp.validate({ productCode: "IKEDC", customer: "04172219014" });
    expect(validate.ok).toBe(true);
    expect(validate.data!.valid).toBe(true);

    const pay = await bp.pay({
      productCode: "IKEDC", customer: "04172219014", customerName: validate.data!.customerName,
      amountMinor: 5000_00, currency: "NGN", meterType: "PREPAID", reference: "TEST-1",
    });
    expect(pay.ok).toBe(true);
    expect(pay.data!.status).toBe("SUCCESS");
    expect(pay.data!.token).toBeTruthy();
    expect(pay.data!.providerRef).toBeTruthy();
  });

  it("IExchangeRateProvider.getQuote returns rate + fees", async () => {
    const fx = await providers.exchangeRate();
    const result = await fx.getQuote("USD", "NGN", 100_00);
    expect(result.ok).toBe(true);
    expect(result.data!.from).toBe("USD");
    expect(result.data!.to).toBe("NGN");
    expect(result.data!.rate).toBeGreaterThan(0);
    expect(result.data!.providerFeeMinor).toBeGreaterThanOrEqual(0);
    expect(result.data!.platformFeeMinor).toBeGreaterThanOrEqual(0);
    expect(result.data!.rateId).toBeTruthy();
  });

  it("IInternationalTransferProvider.send returns pending settlement", async () => {
    const itl = await providers.internationalTransfer();
    const result = await itl.send({
      sourceCurrency: "NGN", destinationCurrency: "USD", amountMinor: 148_500_00,
      beneficiary: { name: "Jane Doe", country: "US" }, purpose: "family support", reference: "INTL-1",
    });
    expect(result.ok).toBe(true);
    expect(result.data!.status).toBe("PENDING");
    expect(result.data!.quotedRate).toBeGreaterThan(0);
    expect(result.data!.destinationAmountMinor).toBeGreaterThan(0);
    expect(result.data!.feesMinor).toBeGreaterThanOrEqual(0);
  });

  it("IInternationalReceivingProvider.parseWebhook normalises inbound event", async () => {
    const provider = new MockInternationalReceivingProvider();
    const result = await provider.parseWebhook(
      { providerRef: "INTL-RECV-1", sourceCurrency: "USD", sourceAmountMinor: 100_00, destinationCurrency: "NGN", destinationAmountMinor: 148_500_00, rate: 1485, feesMinor: 1_00, beneficiaryAccount: "8012345678", sender: { name: "John Doe", country: "US" }, paidAt: new Date().toISOString() },
      {}
    );
    expect(result.ok).toBe(true);
    expect(result.data!.providerRef).toBe("INTL-RECV-1");
    expect(result.data!.destinationCurrency).toBe("NGN");
    expect(result.data!.destinationAmountMinor).toBe(148_500_00);
  });
});
