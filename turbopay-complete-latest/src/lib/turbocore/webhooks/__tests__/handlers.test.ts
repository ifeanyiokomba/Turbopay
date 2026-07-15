/**
 * Webhook Handler Integration Tests
 * ===================================
 *
 * Verifies that all webhook handlers properly normalize
 * provider payloads into internal domain events.
 *
 * NOTE: These tests directly test the handler functions without
 * importing the registry to avoid circular dependency issues.
 */

import { describe, it, expect } from "vitest";

// Direct imports of handler files (not through registry)
import { paystackWebhookHandler } from "../handlers/paystack";
import { flutterwaveWebhookHandler } from "../handlers/flutterwave";
import { monnifyWebhookHandler } from "../handlers/monnify";
import { onafriqWebhookHandler } from "../handlers/onafriq";
import { remitaWebhookHandler } from "../handlers/remita";
import { quicktellerWebhookHandler } from "../handlers/quickteller";

describe("Webhook Handlers", () => {
  describe("Paystack Webhook Handler", () => {
    it("should normalize transfer.success event", () => {
      const payload = {
        event: "transfer.success",
        data: {
          reference: "REF123",
          amount: 1000,
          status: "success",
        },
      };

      const events = paystackWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("TRANSFER_COMPLETED");
      expect(events[0].data.providerRef).toBe("REF123");
    });

    it("should normalize transfer.failed event", () => {
      const payload = {
        event: "transfer.failed",
        data: {
          reference: "REF123",
          amount: 1000,
          status: "failed",
          fail_reason: "Insufficient balance",
        },
      };

      const events = paystackWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("TRANSFER_FAILED");
    });

    it("should normalize charge.success event", () => {
      const payload = {
        event: "charge.success",
        data: {
          reference: "REF123",
          amount: 5000,
          customer: { email: "test@example.com" },
          authorization: { authorization_code: "AUTH123" },
        },
      };

      const events = paystackWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("CARD_FUNDING_SUCCESS");
    });

    it("should normalize subscription.create event", () => {
      const payload = {
        event: "subscription.create",
        data: {
          subscription_code: "SUB123",
          customer: { customer_code: "CUST123" },
          plan: { plan_code: "PLAN123" },
          status: "active",
        },
      };

      const events = paystackWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("SUBSCRIPTION_CREATED");
    });

    it("should normalize dispute.create event", () => {
      const payload = {
        event: "dispute.create",
        data: {
          dispute_code: "DISP123",
          transaction: { reference: "TXN123" },
          category: "fraud",
          amount: 1000,
          currency: "NGN",
        },
      };

      const events = paystackWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("DISPUTE_OPENED");
    });

    it("should normalize settlement.success event", () => {
      const payload = {
        event: "settlement.success",
        data: {
          reference: "SETT123",
          amount: 50000,
          settlement_date: "2024-01-15",
        },
      };

      const events = paystackWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("SETTLEMENT_COMPLETED");
    });
  });

  describe("Flutterwave Webhook Handler", () => {
    it("should normalize transfer.disburse event", () => {
      const payload = {
        event: "transfer.disburse",
        data: {
          id: 12345,
          amount: 1000,
          status: "SUCCESSFUL",
        },
      };

      const events = flutterwaveWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("TRANSFER_COMPLETED");
    });

    it("should normalize charge.completed event", () => {
      const payload = {
        event: "charge.completed",
        data: {
          id: 12345,
          amount: 5000,
          customer: { email: "test@example.com" },
          payment_type: "card",
        },
      };

      const events = flutterwaveWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("CARD_FUNDING_SUCCESS");
    });

    it("should normalize chargeback.created event", () => {
      const payload = {
        event: "chargeback.created",
        data: {
          id: "CB123",
          transaction_id: "TXN123",
          amount: 1000,
          currency: "NGN",
        },
      };

      const events = flutterwaveWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("DISPUTE_OPENED");
    });
  });

  describe("Monnify Webhook Handler", () => {
    it("should normalize SUCCESSFUL_COLLECTION event", () => {
      const payload = {
        eventType: "SUCCESSFUL_COLLECTION",
        eventData: {
          accountReference: "ACC123",
          amountPaid: 5000,
          transactionReference: "TXN123",
        },
      };

      const events = monnifyWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("WALLET_FUNDED");
    });

    it("should normalize SUCCESSFUL_DISBURSEMENT event", () => {
      const payload = {
        eventType: "SUCCESSFUL_DISBURSEMENT",
        eventData: {
          reference: "DISB123",
          amount: 1000,
        },
      };

      const events = monnifyWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("TRANSFER_COMPLETED");
    });

    it("should normalize SETTLEMENT_COMPLETION event", () => {
      const payload = {
        eventType: "SETTLEMENT_COMPLETION",
        eventData: {
          settlementReference: "SETT123",
          amount: 50000,
          settlementDate: "2024-01-15",
        },
      };

      const events = monnifyWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("SETTLEMENT_COMPLETED");
    });
  });

  describe("Onafriq Webhook Handler", () => {
    it("should normalize collection.successful event", () => {
      const payload = {
        eventType: "collection.successful",
        data: {
          id: "COL123",
          amount: 5000,
          currency: "NGN",
          status: "completed",
        },
      };

      const events = onafriqWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("COLLECTION_COMPLETED");
    });

    it("should normalize payment.successful event", () => {
      const payload = {
        eventType: "payment.successful",
        data: {
          id: "PAY123",
          amount: 1000,
          currency: "NGN",
          status: "completed",
        },
      };

      const events = onafriqWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("TRANSFER_COMPLETED");
    });

    it("should normalize momo collection event", () => {
      const payload = {
        eventType: "momo.collection.successful",
        data: {
          id: "MOMO123",
          amount: 2000,
          currency: "GHS",
          network: "MTN",
          status: "completed",
        },
      };

      const events = onafriqWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("MOMO_COLLECTION_COMPLETED");
    });
  });

  describe("Remita Webhook Handler", () => {
    it("should normalize successful payment event", () => {
      const payload = {
        data: {
          RRR: "RRR123",
          amount: 5000,
          paymentStatus: "001",
          customerName: "Test User",
        },
      };

      const events = remitaWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("BILL_PAYMENT_COMPLETED");
    });

    it("should normalize failed payment event", () => {
      const payload = {
        data: {
          RRR: "RRR123",
          amount: 5000,
          paymentStatus: "000",
          customerName: "Test User",
        },
      };

      const events = remitaWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("BILL_PAYMENT_FAILED");
    });
  });

  describe("Quickteller Webhook Handler", () => {
    it("should normalize successful transaction event", () => {
      const payload = {
        data: {
          transactionRef: "TXN123",
          amount: 5000,
          responseCode: "00",
          customerName: "Test User",
        },
      };

      const events = quicktellerWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("BILL_PAYMENT_COMPLETED");
    });

    it("should normalize subscription created event", () => {
      const payload = {
        category: "SUBSCRIPTION",
        action: "CREATED",
        data: {
          transactionRef: "SUB123",
          subscriptionId: "SUBID123",
        },
      };

      const events = quicktellerWebhookHandler.normalize(payload, {});
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("SUBSCRIPTION_CREATED");
    });
  });
});
