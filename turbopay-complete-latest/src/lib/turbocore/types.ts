/** TurboCore shared domain types (provider-agnostic, multi-product). */

export type Currency = "NGN" | "USD" | "EUR" | "GBP" | "CAD" | "AUD" | "GHS" | "KES" | "ZAR";

export type ProductId = "turbopay" | "billswift" | "merchant" | "business" | "developer";

/** Normalised domain events emitted by provider adapters. The business layer
 *  consumes these, never raw provider payloads. */
export type DomainEvent =
  | { type: "WALLET_FUNDED"; walletId: string; amountMinor: number; currency: Currency; providerRef: string; source: string }
  | { type: "BILL_PAID"; productCode: string; customer: string; amountMinor: number; currency: Currency; providerRef: string; token?: string }
  | { type: "INTL_TRANSFER_RECEIVED"; beneficiaryAccount: string; sourceCurrency: Currency; sourceAmountMinor: number; destinationCurrency: Currency; destinationAmountMinor: number; providerRef: string; rate: number }
  | { type: "INTL_TRANSFER_STATUS"; providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }
  | { type: "SETTLEMENT_UPDATED"; providerRef: string; status: "PENDING" | "SETTLED" | "FAILED"; amountMinor: number; currency: Currency };

export interface ProviderAdapterInfo {
  contract: string;
  name: string;
  mode: "mock" | "sandbox" | "production";
  active: boolean;
}
