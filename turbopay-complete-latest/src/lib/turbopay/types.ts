/** Shared Turbopay domain types. */

export type KycTier = 1 | 2 | 3;

export type KycStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";

export type UserStatus = "ACTIVE" | "FROZEN" | "SUSPENDED" | "CLOSED";

export type WalletStatus = "ACTIVE" | "FROZEN";

export type EntryType = "DEBIT" | "CREDIT";

export type RefType =
  | "FUNDING"
  | "TRANSFER"
  | "AIRTIME"
  | "DATA"
  | "BILL"
  | "REVERSAL"
  | "FEE"
  | "WEBHOOK_CREDIT"
  | "VIRTUAL_CARD_FUND"
  | "VIRTUAL_CARD_WITHDRAW"
  | "REWARD_CASHBACK"
  | "REWARD_BONUS"
  | "REFERRAL_REWARD"
  | "INVESTMENT"; // investment purchase + liquidation (user leg + platform-pool leg)

export type TxType =
  | "FUNDING"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "AIRTIME"
  | "DATA"
  | "BILL_ELECTRICITY"
  | "BILL_UTILITY"
  | "REVERSAL"
  | "FEE";

export type TxStatus = "PENDING" | "SUCCESS" | "FAILED" | "REVERSED";

export type Direction = "CREDIT" | "DEBIT";

export interface SessionUser {
  id: string;
  fullName: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  kycTier: KycTier;
  kycStatus: KycStatus;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  role: "USER" | "ADMIN";
  avatarUrl?: string | null;
  bio?: string | null;
  hasTransactionPin: boolean;
  authProvider: "password" | "google" | "apple";
  createdAt: string;
}

export interface WalletView {
  id: string;
  balanceKobo: number;
  currency: string;
  status: WalletStatus;
  ledgerBalanceKobo: number; // computed from ledger (source of truth)
}

export interface VirtualAccountView {
  id: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode: string;
  provider: string;
  status: string;
}

export interface TransactionView {
  id: string;
  reference: string;
  type: TxType;
  direction: Direction;
  amountKobo: number;
  feeKobo: number;
  status: TxStatus;
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  counterpartyBank: string | null;
  description: string | null;
  provider: string | null;
  createdAt: string;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

export interface ApiOk<T> {
  data: T;
}

/** KYC tier limits (kobo). */
export const KYC_LIMITS: Record<
  KycTier,
  { singleTxKobo: number; dailyTxKobo: number; balanceKobo: number; label: string }
> = {
  1: {
    singleTxKobo: 50_000_00, // ₦50,000
    dailyTxKobo: 150_000_00, // ₦150,000
    balanceKobo: 300_000_00, // ₦300,000
    label: "Tier 1 — Starter",
  },
  2: {
    singleTxKobo: 500_000_00, // ₦500,000
    dailyTxKobo: 2_000_000_00, // ₦2,000,000
    balanceKobo: 5_000_000_00, // ₦5,000,000
    label: "Tier 2 — Verified (NIN)",
  },
  3: {
    singleTxKobo: 5_000_000_00, // ₦5,000,000
    dailyTxKobo: 20_000_000_00, // ₦20,000,000
    balanceKobo: Number.MAX_SAFE_INTEGER,
    label: "Tier 3 — Premium (BVN)",
  },
};

/** Map a TxType to a human label. */
export const TX_TYPE_LABELS: Record<TxType, string> = {
  FUNDING: "Wallet Funding",
  TRANSFER_IN: "Transfer Received",
  TRANSFER_OUT: "Transfer Sent",
  AIRTIME: "Airtime Purchase",
  DATA: "Data Purchase",
  BILL_ELECTRICITY: "Electricity Bill",
  BILL_UTILITY: "Utility Payment",
  REVERSAL: "Reversal",
  FEE: "Fee",
};

/** Networks for airtime/data. */
export const NETWORKS = [
  { id: "MTN", name: "MTN", color: "#ffcc00" },
  { id: "GLO", name: "Glo", color: "#0d9c4d" },
  { id: "AIRTEL", name: "Airtel", color: "#e60012" },
  { id: "9MOBILE", name: "9mobile", color: "#00a651" },
];

export const BANKS = [
  { name: "Turbopay MFB", code: "999001" },
  { name: "Access Bank", code: "044" },
  { name: "Guaranty Trust Bank", code: "058" },
  { name: "Zenith Bank", code: "057" },
  { name: "First Bank of Nigeria", code: "011" },
  { name: "United Bank for Africa", code: "033" },
  { name: "Kuda Microfinance Bank", code: "50211" },
  { name: "Opay Digital Services", code: "999992" },
  { name: "Moniepoint MFB", code: "999991" },
  { name: "PalmPay", code: "999995" },
  { name: "Stanbic IBTC Bank", code: "221" },
  { name: "Fidelity Bank", code: "070" },
  { name: "Wema Bank", code: "035" },
  { name: "Sterling Bank", code: "232" },
];
