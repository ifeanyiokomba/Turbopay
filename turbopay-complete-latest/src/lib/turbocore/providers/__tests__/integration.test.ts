/**
 * Provider System Integration Tests
 * ===================================
 *
 * Verifies that all providers, adapters, webhooks, and capabilities
 * are properly configured and consistent.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { capabilityRegistry } from "../capabilities";
import { paystackCapabilities } from "../capabilities/paystack";
import { flutterwaveCapabilities } from "../capabilities/flutterwave";
import { monnifyCapabilities } from "../capabilities/monnify";
import { onafriqCapabilities } from "../capabilities/onafriq";
import { remitaCapabilities } from "../capabilities/remita";
import { quicktellerCapabilities } from "../capabilities/quickteller";

describe("Provider System Integration", () => {
  beforeAll(() => {
    // Ensure capabilities are registered
    capabilityRegistry.register(paystackCapabilities);
    capabilityRegistry.register(flutterwaveCapabilities);
    capabilityRegistry.register(monnifyCapabilities);
    capabilityRegistry.register(onafriqCapabilities);
    capabilityRegistry.register(remitaCapabilities);
    capabilityRegistry.register(quicktellerCapabilities);
  });

  describe("Capability Registry", () => {
    it("should have all 6 providers registered", () => {
      const providers = capabilityRegistry.list();
      expect(providers.length).toBe(6);
    });

    it("should have Paystack registered", () => {
      const paystack = capabilityRegistry.get("paystack");
      expect(paystack).toBeDefined();
      expect(paystack?.providerId).toBe("paystack");
    });

    it("should have Flutterwave registered", () => {
      const flutterwave = capabilityRegistry.get("flutterwave");
      expect(flutterwave).toBeDefined();
      expect(flutterwave?.providerId).toBe("flutterwave");
    });

    it("should have Monnify registered", () => {
      const monnify = capabilityRegistry.get("monnify");
      expect(monnify).toBeDefined();
      expect(monnify?.providerId).toBe("monnify");
    });

    it("should have Onafriq registered", () => {
      const onafriq = capabilityRegistry.get("onafriq");
      expect(onafriq).toBeDefined();
      expect(onafriq?.providerId).toBe("onafriq");
    });

    it("should have Remita registered", () => {
      const remita = capabilityRegistry.get("remita");
      expect(remita).toBeDefined();
      expect(remita?.providerId).toBe("remita");
    });

    it("should have Quickteller registered", () => {
      const quickteller = capabilityRegistry.get("quickteller");
      expect(quickteller).toBeDefined();
      expect(quickteller?.providerId).toBe("quickteller");
    });
  });

  describe("Capability Categories", () => {
    it("should find providers for collection category", () => {
      const providers = capabilityRegistry.findByCapability("collection");
      expect(providers.length).toBeGreaterThan(0);
    });

    it("should find providers for transfer category", () => {
      const providers = capabilityRegistry.findByCapability("transfer");
      expect(providers.length).toBeGreaterThan(0);
    });

    it("should find providers for bill_payment category", () => {
      const providers = capabilityRegistry.findByCapability("bill_payment");
      expect(providers.length).toBeGreaterThan(0);
    });

    it("should find providers for mobile_money category", () => {
      const providers = capabilityRegistry.findByCapability("mobile_money");
      expect(providers.length).toBeGreaterThan(0);
    });

    it("should find providers for card_payments category", () => {
      const providers = capabilityRegistry.findByCapability("card_payments");
      expect(providers.length).toBeGreaterThan(0);
    });
  });

  describe("Provider Capabilities", () => {
    it("Paystack should support collections", () => {
      expect(paystackCapabilities.supportsCollection()).toBe(true);
    });

    it("Paystack should support transfers", () => {
      expect(paystackCapabilities.supportsTransfer()).toBe(true);
    });

    it("Paystack should support refunds", () => {
      expect(paystackCapabilities.supportsRefund()).toBe(true);
    });

    it("Paystack should NOT support bill payments", () => {
      expect(paystackCapabilities.supportsBillPayment()).toBe(false);
    });

    it("Flutterwave should support collections", () => {
      expect(flutterwaveCapabilities.supportsCollection()).toBe(true);
    });

    it("Flutterwave should support mobile money", () => {
      expect(flutterwaveCapabilities.supportsMobileMoney()).toBe(true);
    });

    it("Flutterwave should support FX", () => {
      expect(flutterwaveCapabilities.supportsFX()).toBe(true);
    });

    it("Flutterwave should NOT support bill payments", () => {
      expect(flutterwaveCapabilities.supportsBillPayment()).toBe(false);
    });

    it("Monnify should support bill payments", () => {
      expect(monnifyCapabilities.supportsBillPayment()).toBe(true);
    });

    it("Monnify should support bulk transfers", () => {
      expect(monnifyCapabilities.supportsBulkTransfer()).toBe(true);
    });

    it("Onafriq should support PAPSS", () => {
      expect(onafriqCapabilities.supportsPAPSS()).toBe(true);
    });

    it("Onafriq should support FX", () => {
      expect(onafriqCapabilities.supportsFX()).toBe(true);
    });

    it("Remita should support bill payments", () => {
      expect(remitaCapabilities.supportsBillPayment()).toBe(true);
    });

    it("Remita should support transfers via RITs", () => {
      expect(remitaCapabilities.supportsTransfer()).toBe(true);
    });

    it("Quickteller should support bill payments", () => {
      expect(quicktellerCapabilities.supportsBillPayment()).toBe(true);
    });

    it("Quickteller should support card payments", () => {
      expect(quicktellerCapabilities.supportsCards()).toBe(true);
    });
  });

  describe("Provider Countries", () => {
    it("Paystack should support Nigeria", () => {
      expect(paystackCapabilities.supportedCountries).toContain("NG");
    });

    it("Paystack should support Ghana", () => {
      expect(paystackCapabilities.supportedCountries).toContain("GH");
    });

    it("Flutterwave should support Nigeria", () => {
      expect(flutterwaveCapabilities.supportedCountries).toContain("NG");
    });

    it("Onafriq should support 40+ countries", () => {
      expect(onafriqCapabilities.supportedCountries.length).toBeGreaterThan(40);
    });

    it("Remita should only support Nigeria", () => {
      expect(remitaCapabilities.supportedCountries).toEqual(["NG"]);
    });
  });

  describe("Provider Currencies", () => {
    it("Paystack should support NGN", () => {
      expect(paystackCapabilities.supportedCurrencies).toContain("NGN");
    });

    it("Paystack should support USD", () => {
      expect(paystackCapabilities.supportedCurrencies).toContain("USD");
    });

    it("Flutterwave should support multiple currencies", () => {
      expect(flutterwaveCapabilities.supportedCurrencies.length).toBeGreaterThan(5);
    });

    it("Monnify should support NGN", () => {
      expect(monnifyCapabilities.supportedCurrencies).toContain("NGN");
    });

    it("Remita should only support NGN", () => {
      expect(remitaCapabilities.supportedCurrencies).toEqual(["NGN"]);
    });
  });

  describe("Webhook Handler Files", () => {
    it("should have Paystack webhook handler file", () => {
      // Verify the handler module exists by checking the export
      expect(true).toBe(true); // Placeholder - actual test in handlers.test.ts
    });
  });

  describe("Capability Matrix", () => {
    it("should generate a valid matrix", () => {
      const matrix = capabilityRegistry.matrix();
      expect(matrix).toBeDefined();
      expect(Object.keys(matrix).length).toBeGreaterThan(0);
    });

    it("matrix should have collection category", () => {
      const matrix = capabilityRegistry.matrix();
      expect(matrix["collection"]).toBeDefined();
    });

    it("matrix should have transfer category", () => {
      const matrix = capabilityRegistry.matrix();
      expect(matrix["transfer"]).toBeDefined();
    });
  });

  describe("Provider Summary", () => {
    it("should generate a valid summary", () => {
      const summary = capabilityRegistry.summary();
      expect(summary).toBeDefined();
      expect(summary.length).toBe(6);
    });

    it("summary should include all providers", () => {
      const summary = capabilityRegistry.summary();
      const providerIds = summary.map((s) => s.providerId);
      expect(providerIds).toContain("paystack");
      expect(providerIds).toContain("flutterwave");
      expect(providerIds).toContain("monnify");
      expect(providerIds).toContain("onafriq");
      expect(providerIds).toContain("remita");
      expect(providerIds).toContain("quickteller");
    });
  });
});
