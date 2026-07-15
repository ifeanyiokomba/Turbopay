/**
 * Mock adapter implementations for every provider contract.
 *
 * These are deterministic, network-free, and the default in development.
 * They let the entire platform run end-to-end without real provider keys.
 * Each mock returns realistic data so the UI + flows behave as in production.
 */

import * as crypto from "node:crypto";
import type {
  IBillPaymentProvider,
  ICrossBorderSettlementProvider,
  IExchangeRateProvider,
  IInternationalReceivingProvider,
  IInternationalTransferProvider,
  IKYCProvider,
  ILocalTransferProvider,
  INotificationProvider,
  IVirtualAccountProvider,
  IWalletFundingProvider,
  ProviderResult,
  BillProductCatalog,
  WalletFundingInit,
  LocalTransferInput,
  InternationalTransferInput,
  BillValidationInput,
  BillPayInput,
  NotificationPayload,
} from "@/lib/turbocore/providers/interfaces";
import type { Currency } from "@/lib/turbocore/types";

function ok<T>(data: T, providerRef?: string): ProviderResult<T> {
  return { ok: true, data, providerRef };
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function ref(prefix: string) {
  return `${prefix}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
}

function accountNumber() {
  let s = "";
  for (let i = 0; i < 10; i++) s += crypto.randomInt(0, 10).toString();
  return s;
}

// ─── Virtual Account ──────────────────────────────────────────

export class MockVirtualAccountProvider implements IVirtualAccountProvider {
  readonly name = "mock-virtual-account";
  async createReservedAccount(accountName: string, customerRef: string) {
    await delay(120);
    return ok(
      {
        accountNumber: accountNumber(),
        accountName,
        bankName: "Monnify MFB",
        bankCode: "50515",
        providerRef: ref("MNF"),
        currency: "NGN" as Currency,
      },
      ref("MNF")
    );
  }
  async closeAccount(providerRef: string) {
    await delay(80);
    return ok({ closed: true });
  }
}

// ─── Wallet Funding ───────────────────────────────────────────

export class MockWalletFundingProvider implements IWalletFundingProvider {
  readonly name = "mock-wallet-funding";
  async initiateFunding(input: WalletFundingInit) {
    await delay(100);
    return ok(
      {
        providerRef: ref("MNF"),
        status: "SUCCESS" as const,
        settledAmountMinor: input.amountMinor,
        settledCurrency: input.currency,
      },
      ref("MNF")
    );
  }
  async simulateFunding(accountNumber: string, amountMinor: number) {
    await delay(80);
    return {
      event: "SUCCESSFUL_TRANSACTION",
      payload: {
        transactionReference: ref("MNF"),
        paymentReference: ref("TP"),
        accountReference: accountNumber,
        paidAt: new Date().toISOString(),
        amount: amountMinor / 100,
        amountPaid: amountMinor / 100,
        paymentMethod: "ACCOUNT_TRANSFER",
        paymentStatus: "PAID",
        currency: "NGN",
        settlementAmount: amountMinor / 100,
      },
    };
  }
}

// ─── Local Transfer ───────────────────────────────────────────

export class MockLocalTransferProvider implements ILocalTransferProvider {
  readonly name = "mock-local-transfer";
  async transfer(input: LocalTransferInput) {
    await delay(150);
    const providerRef = ref("NIP");
    return ok({ providerRef, status: "SUCCESS" as const }, providerRef);
  }
  async getTransferStatus(providerRef: string) {
    await delay(60);
    return ok({ status: "SUCCESS" as const });
  }
}

// ─── International Transfer ───────────────────────────────────

const MOCK_RATES: Record<string, number> = {
  "USD→NGN": 1485,
  "GBP→NGN": 1880,
  "EUR→NGN": 1600,
  "USD→GHS": 12.1,
  "NGN→USD": 1 / 1485,
};

export class MockInternationalTransferProvider implements IInternationalTransferProvider {
  readonly name = "mock-intl-transfer";
  async send(input: InternationalTransferInput) {
    await delay(300);
    const pair = `${input.sourceCurrency}→${input.destinationCurrency}`;
    const rate = MOCK_RATES[pair] ?? 1;
    const destinationAmountMinor = Math.round(input.amountMinor * rate);
    const feesMinor = Math.round(input.amountMinor * 0.01); // 1% fee
    const providerRef = ref("INTL");
    return ok(
      {
        providerRef,
        status: "PENDING" as const,
        quotedRate: rate,
        destinationAmountMinor,
        feesMinor,
        settlementCurrency: input.destinationCurrency,
      },
      providerRef
    );
  }
  async getStatus(providerRef: string) {
    await delay(100);
    return ok({ status: "SUCCESS" as const });
  }
}

// ─── International Receiving ───────────────────────────────────

export class MockInternationalReceivingProvider implements IInternationalReceivingProvider {
  readonly name = "mock-intl-receiving";
  async parseWebhook(rawPayload: unknown, headers: Record<string, string>) {
    await delay(80);
    const p = rawPayload as any;
    const event = {
      providerRef: p.providerRef ?? ref("INTL-R"),
      sourceCurrency: (p.sourceCurrency ?? "USD") as Currency,
      sourceAmountMinor: Number(p.sourceAmountMinor ?? 100_00),
      destinationCurrency: (p.destinationCurrency ?? "NGN") as Currency,
      destinationAmountMinor: Number(p.destinationAmountMinor ?? 148_500_00),
      rate: Number(p.rate ?? 1485),
      feesMinor: Number(p.feesMinor ?? 1_00),
      beneficiaryAccount: p.beneficiaryAccount ?? accountNumber(),
      sender: { name: p.sender?.name ?? "John Doe", country: p.sender?.country ?? "US" },
      paidAt: p.paidAt ?? new Date().toISOString(),
    };
    return ok(event, event.providerRef);
  }
}

// ─── Cross-Border Settlement ──────────────────────────────────

export class MockCrossBorderSettlementProvider implements ICrossBorderSettlementProvider {
  readonly name = "mock-settlement";
  async getSettlement(providerRef: string) {
    await delay(100);
    return ok({
      providerRef,
      settlementCurrency: "NGN" as Currency,
      settlementAmountMinor: 148_500_00,
      status: "SETTLED" as const,
      settledAt: new Date().toISOString(),
    });
  }
}

// ─── Exchange Rate ────────────────────────────────────────────

export class MockExchangeRateProvider implements IExchangeRateProvider {
  readonly name = "mock-fx";
  async getQuote(from: Currency, to: Currency, amountMinor: number) {
    await delay(80);
    const pair = `${from}→${to}`;
    const rate = MOCK_RATES[pair] ?? 1;
    const providerFeeMinor = Math.round(amountMinor * 0.005); // 0.5%
    const platformFeeMinor = Math.round(amountMinor * 0.005); // 0.5%
    return ok({
      from,
      to,
      rate,
      rateId: ref("FX"),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      providerFeeMinor,
      platformFeeMinor,
    });
  }
}

// ─── Bill Payment ─────────────────────────────────────────────

const MOCK_BILL_PRODUCTS: BillProductCatalog[] = [
  { code: "IKEDC", name: "Ikeja Electric", category: "ELECTRICITY", fields: ["meter"], provider: "baxi" },
  { code: "EKEDC", name: "Eko Electric", category: "ELECTRICITY", fields: ["meter"], provider: "baxi" },
  { code: "AEDC", name: "Abuja Electric", category: "ELECTRICITY", fields: ["meter"], provider: "baxi" },
  { code: "DSTV", name: "DStv", category: "CABLE_TV", fields: ["smartcard"], provider: "baxi" },
  { code: "GOTV", name: "GOtv", category: "CABLE_TV", fields: ["iac"], provider: "baxi" },
  { code: "SPECTRANET", name: "Spectranet", category: "INTERNET", fields: ["account"], provider: "baxi" },
  { code: "REMITA_RRR", name: "Remita (Government)", category: "GOVERNMENT", fields: ["rrr"], provider: "remita" },
  { code: "QUICKTELLER", name: "Quickteller", category: "GENERAL", fields: ["reference"], provider: "quickteller" },
];

export class MockBillPaymentProvider implements IBillPaymentProvider {
  readonly name = "mock-bill-payment";
  async listProducts() {
    await delay(60);
    return ok(MOCK_BILL_PRODUCTS);
  }
  async validate(input: BillValidationInput) {
    await delay(120);
    const seed = input.customer.split("").reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
    const names = ["ADEKUNLE O. CHIWE", "BOLANLE M. SAVAGE", "CHUKWUEMEKA OBI", "FATIMA B. YUSUF"];
    const valid = input.customer.length >= 6;
    return ok({
      valid,
      customerName: names[seed % names.length],
      message: valid ? "Validated" : "Invalid customer reference",
    });
  }
  async pay(input: BillPayInput) {
    await delay(200);
    const providerRef = ref("BAX");
    return ok(
      {
        providerRef,
        status: "SUCCESS" as const,
        token: input.meterType === "PREPAID" ? crypto.randomBytes(8).toString("hex").toUpperCase() : undefined,
        receiptNumber: ref("RCP"),
      },
      providerRef
    );
  }
}

// ─── KYC ──────────────────────────────────────────────────────

export class MockKYCProvider implements IKYCProvider {
  readonly name = "mock-kyc";
  async verifyNin(nin: string) {
    await delay(160);
    const valid = /^\d{11}$/.test(nin);
    const seed = nin.split("").reduce((a, c) => a + parseInt(c, 10), 0);
    const firsts = ["Adekunle", "Bolanle", "Chukwuemeka", "Fatima", "Tunde", "Ngozi", "Ibrahim"];
    const lasts = ["Adeyemi", "Savage", "Obi", "Yusuf", "Okoro", "Eze", "Bello"];
    const states = ["Lagos", "Ogun", "Anambra", "Kano", "Rivers", "Enugu", "Kwara"];
    const lgas = ["Ikeja", "Surulere", "Awka South", "Nassarawa", "Port Harcourt", "Enugu South", "Ilorin South"];
    const towns = ["Ojuelegba", "Yaba", "Fegge", "Nassarawa GRA", "Diobu", "Ogui", "Tanke"];
    const result = {
      verified: valid,
      firstName: firsts[seed % firsts.length],
      lastName: lasts[(seed * 7) % lasts.length],
      middleName: "O.",
      dob: `19${80 + (seed % 20)}-0${1 + (seed % 8)}-1${seed % 9}`,
      gender: seed % 2 === 0 ? "M" : "F",
      providerRef: `MOCK-NIN-${nin.slice(-4)}`,
      stateOfOrigin: states[seed % states.length],
      lga: lgas[seed % lgas.length],
      town: towns[seed % towns.length],
    };
    return ok(result, result.providerRef);
  }
  async verifyBvn(bvn: string, phone: string) {
    await delay(180);
    const valid = /^\d{11}$/.test(bvn);
    const seed = bvn.split("").reduce((a, c) => a + parseInt(c, 10), 0);
    const firsts = ["Adekunle", "Bolanle", "Chukwuemeka", "Fatima", "Tunde", "Ngozi", "Ibrahim"];
    const lasts = ["Adeyemi", "Savage", "Obi", "Yusuf", "Okoro", "Eze", "Bello"];
    const states = ["Lagos", "Ogun", "Anambra", "Kano", "Rivers", "Enugu", "Kwara"];
    const lgas = ["Ikeja", "Surulere", "Awka South", "Nassarawa", "Port Harcourt", "Enugu South", "Ilorin South"];
    const towns = ["Ojuelegba", "Yaba", "Fegge", "Nassarawa GRA", "Diobu", "Ogui", "Tanke"];
    const result = {
      verified: valid,
      firstName: firsts[seed % firsts.length],
      lastName: lasts[(seed * 7) % lasts.length],
      middleName: "O.",
      dob: `19${75 + (seed % 25)}-0${1 + (seed % 8)}-1${seed % 9}`,
      gender: seed % 2 === 0 ? "M" : "F",
      providerRef: `MOCK-BVN-${bvn.slice(-4)}`,
      phoneMatch: true,
      stateOfOrigin: states[seed % states.length],
      lga: lgas[seed % lgas.length],
      town: towns[seed % towns.length],
    };
    return ok(result, result.providerRef);
  }
  async verifyIdentity(input: import("@/lib/turbocore/providers/interfaces").IdentityVerificationInput) {
    await delay(200);
    const seed = input.documentValue.split("").reduce((a: number, c: string) => a + (parseInt(c, 10) || 0), 0);
    const firsts = ["Adekunle", "Bolanle", "Chukwuemeka", "Fatima", "Tunde", "Ngozi", "Ibrahim", "John", "Sarah", "Kwame"];
    const lasts = ["Adeyemi", "Savage", "Obi", "Yusuf", "Okoro", "Eze", "Bello", "Smith", "Johnson", "Mensah"];
    const result = {
      verified: input.documentValue.length >= 6,
      firstName: firsts[seed % firsts.length],
      lastName: lasts[(seed * 7) % lasts.length],
      middleName: "M.",
      dob: `19${75 + (seed % 25)}-0${1 + (seed % 9)}-${10 + (seed % 19)}`,
      gender: seed % 2 === 0 ? "M" : "F",
      providerRef: `MOCK-IDENTITY-${input.documentType}-${input.documentValue.slice(-4)}`,
    };
    return ok(result, result.providerRef);
  }
}

// ─── Notification ─────────────────────────────────────────────

export class MockNotificationProvider implements INotificationProvider {
  readonly name = "mock-notification";
  async send(payload: NotificationPayload) {
    await delay(50);
    // Mock: log the notification (in production this would call Termii/Resend).
    console.log(`[notification:${payload.channel}] → ${payload.to} [${payload.template}]`, payload.variables);
    return ok({ delivered: true, messageId: ref("MSG") });
  }
}
