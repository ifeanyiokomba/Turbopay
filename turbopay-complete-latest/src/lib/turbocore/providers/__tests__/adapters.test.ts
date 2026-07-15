/**
 * Adapter Factory Integration Tests
 * ===================================
 *
 * Verifies that all adapters can be instantiated and implement
 * the required interfaces.
 */

import { describe, it, expect } from "vitest";

describe("Adapter Factory", () => {
  describe("Paystack Extended Adapters", () => {
    it("should export PaystackSubscriptionProvider", async () => {
      const mod = await import("../adapters/paystack-extended");
      expect(mod.PaystackSubscriptionProvider).toBeDefined();
    });

    it("should export PaystackDisputeProvider", async () => {
      const mod = await import("../adapters/paystack-extended");
      expect(mod.PaystackDisputeProvider).toBeDefined();
    });

    it("should export PaystackSettlementProvider", async () => {
      const mod = await import("../adapters/paystack-extended");
      expect(mod.PaystackSettlementProvider).toBeDefined();
    });

    it("should export PaystackPaymentPageProvider", async () => {
      const mod = await import("../adapters/paystack-extended");
      expect(mod.PaystackPaymentPageProvider).toBeDefined();
    });

    it("should export PaystackSplitPaymentProvider", async () => {
      const mod = await import("../adapters/paystack-extended");
      expect(mod.PaystackSplitPaymentProvider).toBeDefined();
    });

    it("should export PaystackCustomerProvider", async () => {
      const mod = await import("../adapters/paystack-extended");
      expect(mod.PaystackCustomerProvider).toBeDefined();
    });
  });

  describe("Monnify Extended Adapters", () => {
    it("should export MonnifyTransferProvider", async () => {
      const mod = await import("../adapters/monnify-extended");
      expect(mod.MonnifyTransferProvider).toBeDefined();
    });

    it("should export MonnifyBillPaymentProvider", async () => {
      const mod = await import("../adapters/monnify-extended");
      expect(mod.MonnifyBillPaymentProvider).toBeDefined();
    });

    it("should export MonnifyRefundProvider", async () => {
      const mod = await import("../adapters/monnify-extended");
      expect(mod.MonnifyRefundProvider).toBeDefined();
    });

    it("should export MonnifySettlementProvider", async () => {
      const mod = await import("../adapters/monnify-extended");
      expect(mod.MonnifySettlementProvider).toBeDefined();
    });

    it("should export MonnifyInvoiceProvider", async () => {
      const mod = await import("../adapters/monnify-extended");
      expect(mod.MonnifyInvoiceProvider).toBeDefined();
    });

    it("should export MonnifySplitPaymentProvider", async () => {
      const mod = await import("../adapters/monnify-extended");
      expect(mod.MonnifySplitPaymentProvider).toBeDefined();
    });

    it("should export MonnifyKycProvider", async () => {
      const mod = await import("../adapters/monnify-extended");
      expect(mod.MonnifyKycProvider).toBeDefined();
    });

    it("should export MonnifyWalletProvider", async () => {
      const mod = await import("../adapters/monnify-extended");
      expect(mod.MonnifyWalletProvider).toBeDefined();
    });
  });

  describe("Quickteller Extended Adapters", () => {
    it("should export QuicktellerCollectionProvider", async () => {
      const mod = await import("../adapters/quickteller-extended");
      expect(mod.QuicktellerCollectionProvider).toBeDefined();
    });

    it("should export QuicktellerTransferProvider", async () => {
      const mod = await import("../adapters/quickteller-extended");
      expect(mod.QuicktellerTransferProvider).toBeDefined();
    });

    it("should export QuicktellerRefundProvider", async () => {
      const mod = await import("../adapters/quickteller-extended");
      expect(mod.QuicktellerRefundProvider).toBeDefined();
    });

    it("should export QuicktellerSubscriptionProvider", async () => {
      const mod = await import("../adapters/quickteller-extended");
      expect(mod.QuicktellerSubscriptionProvider).toBeDefined();
    });

    it("should export QuicktellerPayoutProvider", async () => {
      const mod = await import("../adapters/quickteller-extended");
      expect(mod.QuicktellerPayoutProvider).toBeDefined();
    });

    it("should export QuicktellerSettlementProvider", async () => {
      const mod = await import("../adapters/quickteller-extended");
      expect(mod.QuicktellerSettlementProvider).toBeDefined();
    });
  });

  describe("Onafriq Adapters", () => {
    it("should export OnafriqCollectionProvider", async () => {
      const mod = await import("../adapters/onafriq");
      expect(mod.OnafriqCollectionProvider).toBeDefined();
    });

    it("should export OnafriqTransferProvider", async () => {
      const mod = await import("../adapters/onafriq");
      expect(mod.OnafriqTransferProvider).toBeDefined();
    });

    it("should export OnafriqMobileMoneyProvider", async () => {
      const mod = await import("../adapters/onafriq");
      expect(mod.OnafriqMobileMoneyProvider).toBeDefined();
    });

    it("should export OnafriqFxProvider", async () => {
      const mod = await import("../adapters/onafriq");
      expect(mod.OnafriqFxProvider).toBeDefined();
    });

    it("should export OnafriqPapssProvider", async () => {
      const mod = await import("../adapters/onafriq");
      expect(mod.OnafriqPapssProvider).toBeDefined();
    });

    it("should export OnafriqSettlementProvider", async () => {
      const mod = await import("../adapters/onafriq");
      expect(mod.OnafriqSettlementProvider).toBeDefined();
    });

    it("should export OnafriqBalanceProvider", async () => {
      const mod = await import("../adapters/onafriq");
      expect(mod.OnafriqBalanceProvider).toBeDefined();
    });

    it("should export OnafriqCardProvider", async () => {
      const mod = await import("../adapters/onafriq");
      expect(mod.OnafriqCardProvider).toBeDefined();
    });

    it("should export OnafriqBillPaymentProvider", async () => {
      const mod = await import("../adapters/onafriq");
      expect(mod.OnafriqBillPaymentProvider).toBeDefined();
    });

    it("should export OnafriqWalletFundingProvider", async () => {
      const mod = await import("../adapters/onafriq");
      expect(mod.OnafriqWalletFundingProvider).toBeDefined();
    });
  });

  describe("Adapter Interface Compliance", () => {
    it("PaystackSubscriptionProvider should have required methods", async () => {
      const { PaystackSubscriptionProvider } = await import("../adapters/paystack-extended");
      const adapter = new PaystackSubscriptionProvider({
        secretKey: "test",
        publicKey: "test",
        baseUrl: "https://api.paystack.co",
      });
      expect(adapter.createPlan).toBeDefined();
      expect(adapter.listPlans).toBeDefined();
      expect(adapter.getPlan).toBeDefined();
      expect(adapter.createSubscription).toBeDefined();
      expect(adapter.listSubscriptions).toBeDefined();
      expect(adapter.getSubscription).toBeDefined();
      expect(adapter.enableSubscription).toBeDefined();
      expect(adapter.disableSubscription).toBeDefined();
    });

    it("MonnifyTransferProvider should have required methods", async () => {
      const { MonnifyTransferProvider } = await import("../adapters/monnify-extended");
      const adapter = new MonnifyTransferProvider({
        apiKey: "test",
        secretKey: "test",
        contractCode: "test",
        baseUrl: "https://api.monnify.com",
      });
      expect(adapter.initiateTransfer).toBeDefined();
      expect(adapter.bulkTransfer).toBeDefined();
    });

    it("QuicktellerCollectionProvider should have required methods", async () => {
      const { QuicktellerCollectionProvider } = await import("../adapters/quickteller-extended");
      const adapter = new QuicktellerCollectionProvider({
        apiKey: "test",
        clientSecret: "test",
        merchantCode: "test",
        baseUrl: "https://orion.interswitchng.com",
      });
      expect(adapter.initializePayment).toBeDefined();
      expect(adapter.getTransactionStatus).toBeDefined();
    });

    it("OnafriqCollectionProvider should have required methods", async () => {
      const { OnafriqCollectionProvider } = await import("../adapters/onafriq");
      const adapter = new OnafriqCollectionProvider({
        apiKey: "test",
        baseUrl: "https://api.onafriq.com/v1",
      });
      expect(adapter.initializeCollection).toBeDefined();
      expect(adapter.getCollectionStatus).toBeDefined();
    });
  });
});
