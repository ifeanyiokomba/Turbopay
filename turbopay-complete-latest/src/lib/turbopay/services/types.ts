/**
 * Turbopay Service Layer — shared types.
 * =======================================
 *
 * Service methods are the single business-logic surface for the 7 core
 * transactional routes (airtime, data, electricity, utilities, transfer,
 * wallet fund, kyc). Routes are thin handlers that:
 *   1. authenticate via `requireUser()`
 *   2. parse + Zod-validate the request body
 *   3. call a service method
 *   4. return `json({ data: result })` on success, `errorJson(...)` on failure
 *
 * Service methods throw `ServiceError` for business-level failures (PIN
 * invalid, AML block, provider failure, KYC rejection, etc.). Routes catch
 * `ServiceError` and convert it to an `errorJson` response with the
 * appropriate HTTP status + code.
 */

import type { SessionUser } from "@/lib/turbopay/types";

/**
 * Business-level error thrown by service methods. Mirrors `AuthError`'s shape
 * so the route's catch block can use a single uniform error-handling pattern.
 */
export class ServiceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
  }
}

/** Network enum — airtime/data only. */
export type Network = "MTN" | "GLO" | "AIRTEL" | "9MOBILE";

/** Meter type — electricity only. */
export type MeterType = "PREPAID" | "POSTPAID";

// ─── BillingService ────────────────────────────────────────────────────

export interface BuyAirtimeInput {
  user: SessionUser;
  phoneNumber: string;
  network: Network;
  amountNaira: number;
  pin: string;
  ip?: string;
  idemKey?: string;
}

export interface BuyAirtimeResult {
  ok: true;
  reference: string;
  providerRef: string;
  newBalanceKobo: number;
}

export interface BuyDataInput {
  user: SessionUser;
  phoneNumber: string;
  planId: string;
  pin: string;
  ip?: string;
  idemKey?: string;
}

export interface BuyDataResult {
  ok: true;
  reference: string;
  providerRef: string;
  newBalanceKobo: number;
}

export interface ValidateElectricityInput {
  user: SessionUser;
  discoCode: string;
  meterNumber: string;
  meterType: MeterType;
}

export interface PayElectricityInput {
  user: SessionUser;
  discoCode: string;
  discoName: string;
  meterNumber: string;
  meterType: MeterType;
  customerName: string;
  amountNaira: number;
  pin: string;
  ip?: string;
  idemKey?: string;
}

export interface PayElectricityResult {
  ok: true;
  reference: string;
  providerRef: string;
  token: string | null;
  newBalanceKobo: number;
}

export interface ValidateUtilityInput {
  user: SessionUser;
  code: string;
  customer: string;
}

export interface PayUtilityInput {
  user: SessionUser;
  code: string;
  customer: string;
  customerName: string;
  productName: string;
  category: string;
  amountNaira: number;
  pin: string;
  ip?: string;
  idemKey?: string;
}

export interface PayUtilityResult {
  ok: true;
  reference: string;
  providerRef: string;
  newBalanceKobo: number;
}

// ─── TransferService ───────────────────────────────────────────────────

export interface SendTransferInput {
  user: SessionUser;
  recipient?: string;
  accountNumber?: string;
  bankCode?: string;
  bankName?: string;
  recipientName?: string;
  amountNaira: number;
  note?: string;
  saveBeneficiary?: boolean;
  pin: string;
  ip?: string;
  idemKey: string | null;
}

export interface SendTransferResult {
  ok: true;
  reference: string;
  amountKobo: number;
  feeKobo: number;
  recipientName: string;
  newBalanceKobo: number;
  external?: boolean;
  providerRef?: string;
}

// ─── WalletService ─────────────────────────────────────────────────────

export interface GetWalletResult {
  wallet: {
    id: string;
    balanceKobo: number;
    currency: string;
    status: string;
    ledgerBalanceKobo: number;
  };
  virtualAccount: {
    id: string;
    accountNumber: string;
    accountName: string;
    bankName: string;
    bankCode: string;
    provider: string;
    status: string;
  } | null;
  provisioningError: string | null;
  cardsEnabled: boolean;
  beneficiaries: Array<{
    id: string;
    name: string;
    accountNumber: string;
    bankName: string | null;
    bankCode: string | null;
    type: string;
  }>;
}

export interface FundWalletInput {
  user: SessionUser;
  amountNaira: number;
}

export interface FundWalletResult {
  ok: true;
  transactionId: string | null;
  amountNaira: number;
}

// ─── CardService ───────────────────────────────────────────────────────

export interface CreateCardInput {
  user: SessionUser;
  type?: "VIRTUAL" | "PHYSICAL";
  spendingLimitKobo?: number;
}

export interface FundCardInput {
  user: SessionUser;
  cardId: string;
  amountKobo: number;
  pin?: string;
}

export interface WithdrawCardInput {
  user: SessionUser;
  cardId: string;
  amountKobo: number;
  pin?: string;
}

export interface CardActionInput {
  user: SessionUser;
  cardId: string;
}

// ─── KycService ────────────────────────────────────────────────────────

export interface GetKycStatusResult {
  tier: number;
  status: string;
  record: {
    tier: number;
    status: string;
    provider: string | null;
    verifiedAt: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  limits: { singleTxKobo: number; dailyTxKobo: number; balanceKobo: number; label: string };
  allLimits: Record<number, { singleTxKobo: number; dailyTxKobo: number; balanceKobo: number; label: string }>;
}

export interface VerifyNinResult {
  ok: true;
  tier: 2;
  name: string;
  verifiedData: {
    dateOfBirth: string;
    gender: string;
    stateOfOrigin?: string;
    lga?: string;
    town?: string;
  };
}

export interface VerifyBvnResult {
  ok: true;
  tier: 3;
  name: string;
  verifiedData: {
    dateOfBirth: string;
    gender: string;
    stateOfOrigin?: string;
    lga?: string;
    town?: string;
  };
}
