import { generateAccountNumber, generateReference } from "@/lib/turbopay/money";

/**
 * PROVIDER LAYER — simulated integrations with licensed Nigerian
 * fintech infrastructure providers. In production these wrap real APIs;
 * here they mimic the contract so the platform behaves end-to-end.
 *
 *  - Monnify: virtual reserved accounts + funding webhooks
 *  - Baxi:    airtime, data, electricity & utility bills
 *  - Dojah:   KYC (NIN / BVN verification)
 */

const MONNIFY_BANK = { name: "Monnify MFB", code: "50515" };

export interface VirtualAccountCreated {
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode: string;
  providerRef: string;
}

/** Simulate Monnify reserved-account creation. */
export async function monnifyCreateReservedAccount(
  accountName: string,
  customerRef: string
): Promise<VirtualAccountCreated> {
  // simulate latency
  await delay(120);
  return {
    accountNumber: generateAccountNumber(),
    accountName,
    bankName: MONNIFY_BANK.name,
    bankCode: MONNIFY_BANK.code,
    providerRef: `MNF-${customerRef}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  };
}

/** Simulate a Monnify funding webhook payload (used by the demo "Simulate funding" flow). */
export async function monnifySimulateFunding(
  accountNumber: string,
  amountKobo: number
): Promise<{ event: string; payload: Record<string, unknown> }> {
  await delay(80);
  return {
    event: "SUCCESSFUL_TRANSACTION",
    payload: {
      transactionReference: generateReference("MNF"),
      paymentReference: generateReference("TP"),
      accountReference: accountNumber,
      paidAt: new Date().toISOString(),
      amount: amountKobo / 100,
      amountPaid: amountKobo / 100,
      paymentMethod: "ACCOUNT_TRANSFER",
      paymentStatus: "PAID",
      currency: "NGN",
      settlementAmount: amountKobo / 100,
    },
  };
}

export interface AirtimeResult {
  providerRef: string;
  status: "SUCCESS";
}
export async function baxiPurchaseAirtime(
  phoneNumber: string,
  network: string,
  amountKobo: number
): Promise<AirtimeResult> {
  await delay(150);
  return { providerRef: generateReference("BAX"), status: "SUCCESS" };
}

export interface DataPlan {
  id: string;
  network: string;
  name: string;
  size: string;
  duration: string;
  amountKobo: number;
}

export const DATA_PLANS: DataPlan[] = [
  { id: "mtn-d1", network: "MTN", name: "MTN 1GB", size: "1 GB", duration: "30 days", amountKobo: 350_00 },
  { id: "mtn-d2", network: "MTN", name: "MTN 3GB", size: "3 GB", duration: "30 days", amountKobo: 1_000_00 },
  { id: "mtn-d3", network: "MTN", name: "MTN 10GB", size: "10 GB", duration: "30 days", amountKobo: 3_500_00 },
  { id: "glo-d1", network: "GLO", name: "Glo 1.35GB", size: "1.35 GB", duration: "30 days", amountKobo: 500_00 },
  { id: "glo-d2", network: "GLO", name: "Glo 5.8GB", size: "5.8 GB", duration: "30 days", amountKobo: 2_000_00 },
  { id: "airtel-d1", network: "AIRTEL", name: "Airtel 1.5GB", size: "1.5 GB", duration: "30 days", amountKobo: 500_00 },
  { id: "airtel-d2", network: "AIRTEL", name: "Airtel 7GB", size: "7 GB", duration: "30 days", amountKobo: 2_500_00 },
  { id: "9mobile-d1", network: "9MOBILE", name: "9mobile 1GB", size: "1 GB", duration: "30 days", amountKobo: 400_00 },
  { id: "9mobile-d2", network: "9MOBILE", name: "9mobile 4.5GB", size: "4.5 GB", duration: "30 days", amountKobo: 1_500_00 },
];

export function getDataPlans(network?: string): DataPlan[] {
  return network ? DATA_PLANS.filter((p) => p.network === network) : DATA_PLANS;
}

export async function baxiPurchaseData(
  phoneNumber: string,
  plan: DataPlan
): Promise<AirtimeResult> {
  await delay(150);
  return { providerRef: generateReference("BAX"), status: "SUCCESS" };
}

export interface Disco {
  id: string;
  name: string;
  code: string;
  short: string;
}

export const DISCOS: Disco[] = [
  { id: "ikedc", name: "Ikeja Electric (IKEDC)", code: "IKEDC", short: "IKEJA" },
  { id: "ekedc", name: "Eko Electric (EKEDC)", code: "EKEDC", short: "EKO" },
  { id: "aedc", name: "Abuja Electric (AEDC)", code: "AEDC", short: "ABUJA" },
  { id: "phed", name: "Port Harcourt Electric (PHED)", code: "PHED", short: "PH" },
  { id: "ibedc", name: "Ibadan Electric (IBEDC)", code: "IBEDC", short: "IBADAN" },
  { id: "kaedco", name: "Kano Electric (KAEDCO)", code: "KAEDCO", short: "KANO" },
  { id: "jed", name: "Jos Electric (JED)", code: "JED", short: "JOS" },
  { id: "yedc", name: "Yola Electric (YEDC)", code: "YEDC", short: "YOLA" },
];

export interface BillProduct {
  id: string;
  category: "CABLE_TV" | "WATER" | "INTERNET" | "REMITA" | "QUICKTELLER";
  name: string;
  code: string;
  fields: string[];
  fixedAmountKobo?: number;
}

export const BILL_PRODUCTS: BillProduct[] = [
  { id: "dstv", category: "CABLE_TV", name: "DStv", code: "DSTV", fields: ["smartcard"] },
  { id: "gotv", category: "CABLE_TV", name: "GOtv", code: "GOTV", fields: ["iac"] },
  { id: "startimes", category: "CABLE_TV", name: "StarTimes", code: "STARTIMES", fields: ["smartcard"] },
  { id: "showmax", category: "CABLE_TV", name: "Showmax", code: "SHOWMAX", fields: ["mobile"], fixedAmountKobo: 3_600_00 },
  { id: "water-lagos", category: "WATER", name: "Lagos Water", code: "LWC", fields: ["customer"] },
  { id: "internet-spectranet", category: "INTERNET", name: "Spectranet", code: "SPECTRANET", fields: ["account"] },
  { id: "internet-smile", category: "INTERNET", name: "Smile", code: "SMILE", fields: ["account"] },
  { id: "remita-revenue", category: "REMITA", name: "Remita (Government Payments)", code: "REMITA_RRR", fields: ["rrr"] },
  { id: "quickteller-general", category: "QUICKTELLER", name: "Quickteller (Bills)", code: "QUICKTELLER", fields: ["reference"] },
];

export interface BillValidation {
  valid: boolean;
  customerName: string;
  message: string;
}

export async function baxiValidateElectricity(
  discoCode: string,
  meterNumber: string,
  meterType: "PREPAID" | "POSTPAID"
): Promise<BillValidation> {
  await delay(120);
  // Deterministic mock: derive a name from the meter number.
  const seed = meterNumber.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const names = ["ADEKUNLE O. CHIWE", "BOLANLE M. SAVAGE", "CHUKWUEMEKA OBI", "FATIMA B. YUSUF", "TUNDÉ A. OKORO"];
  return {
    valid: meterNumber.length >= 8,
    customerName: names[seed % names.length],
    message: meterNumber.length >= 8 ? "Meter validated" : "Invalid meter number",
  };
}

export async function baxiValidateBill(
  code: string,
  customer: string
): Promise<BillValidation> {
  await delay(100);
  const seed = customer.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const names = ["ADEKUNLE O. CHIWE", "BOLANLE M. SAVAGE", "CHUKWUEMEKA OBI", "FATIMA B. YUSUF"];
  return {
    valid: customer.length >= 6,
    customerName: names[seed % names.length],
    message: customer.length >= 6 ? "Customer validated" : "Invalid customer reference",
  };
}

export async function baxiPayElectricity(input: {
  discoCode: string;
  meterNumber: string;
  meterType: "PREPAID" | "POSTPAID";
  amountKobo: number;
  customerName: string;
}): Promise<{ providerRef: string; token?: string; status: "SUCCESS" }> {
  await delay(200);
  return {
    providerRef: generateReference("BAX"),
    token: input.meterType === "PREPAID" ? Math.random().toString(36).slice(2, 16).toUpperCase() : undefined,
    status: "SUCCESS",
  };
}

export async function baxiPayBill(input: {
  code: string;
  customer: string;
  customerName: string;
  amountKobo: number;
}): Promise<{ providerRef: string; status: "SUCCESS" }> {
  await delay(180);
  return { providerRef: generateReference("BAX"), status: "SUCCESS" };
}

/** Dojah KYC simulation — verifies NIN / BVN against a deterministic mock. */
export interface KycResult {
  verified: boolean;
  firstName: string;
  lastName: string;
  middleName?: string;
  dob: string;
  gender: string;
  stateOfOrigin?: string;
  lga?: string;
  town?: string;
  providerRef: string;
}

export async function dojahVerifyNin(nin: string): Promise<KycResult> {
  await delay(160);
  const valid = /^\d{11}$/.test(nin);
  const seed = nin.split("").reduce((a, c) => a + parseInt(c, 10), 0);
  const firsts = ["Adekunle", "Bolanle", "Chukwuemeka", "Fatima", "Tundé", "Ngozi", "Ibrahim"];
  const lasts = ["Adeyemi", "Savage", "Obi", "Yusuf", "Okoro", "Eze", "Bello"];
  const states = ["Lagos", "Ogun", "Anambra", "Kano", "Rivers", "Enugu", "Kwara"];
  const lgas = ["Ikeja", "Surulere", "Awka South", "Nassarawa", "Port Harcourt", "Enugu South", "Ilorin South"];
  const towns = ["Ojuelegba", "Yaba", "Fegge", "Nassarawa GRA", "Diobu", "Ogui", "Tanke"];
  return {
    verified: valid,
    firstName: firsts[seed % firsts.length],
    lastName: lasts[(seed * 7) % lasts.length],
    middleName: "O.",
    dob: `19${80 + (seed % 20)}-0${1 + (seed % 8)}-1${seed % 9}`,
    gender: seed % 2 === 0 ? "M" : "F",
    stateOfOrigin: states[seed % states.length],
    lga: lgas[seed % lgas.length],
    town: towns[seed % towns.length],
    providerRef: `DOJAH-NIN-${nin.slice(-4)}`,
  };
}

export async function dojahVerifyBvn(bvn: string, phone: string): Promise<KycResult & { phoneMatch: boolean }> {
  await delay(180);
  const valid = /^\d{11}$/.test(bvn);
  const seed = bvn.split("").reduce((a, c) => a + parseInt(c, 10), 0);
  const firsts = ["Adekunle", "Bolanle", "Chukwuemeka", "Fatima", "Tundé", "Ngozi", "Ibrahim"];
  const lasts = ["Adeyemi", "Savage", "Obi", "Yusuf", "Okoro", "Eze", "Bello"];
  const states = ["Lagos", "Ogun", "Anambra", "Kano", "Rivers", "Enugu", "Kwara"];
  const lgas = ["Ikeja", "Surulere", "Awka South", "Nassarawa", "Port Harcourt", "Enugu South", "Ilorin South"];
  const towns = ["Ojuelegba", "Yaba", "Fegge", "Nassarawa GRA", "Diobu", "Ogui", "Tanke"];
  return {
    verified: valid,
    firstName: firsts[seed % firsts.length],
    lastName: lasts[(seed * 7) % lasts.length],
    middleName: "O.",
    dob: `19${75 + (seed % 25)}-0${1 + (seed % 8)}-1${seed % 9}`,
    gender: seed % 2 === 0 ? "M" : "F",
    stateOfOrigin: states[seed % states.length],
    lga: lgas[seed % lgas.length],
    town: towns[seed % towns.length],
    providerRef: `DOJAH-BVN-${bvn.slice(-4)}`,
    phoneMatch: true,
  };
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
