/**
 * Unified Biller Discovery API
 * =============================
 *
 * GET /api/bills/unified — returns all billers from all providers, grouped by TurboPay category.
 * GET /api/bills/unified?category=electricity — returns billers for a specific category.
 *
 * Providers: Baxi, Remita, Quickteller, BillSwift
 * Users never see provider complexity — only TurboPay categories.
 */

import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";

// ─── Unified Biller Types ────────────────────────────────────

export interface UnifiedBiller {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Which backend provider handles this biller. */
  provider: "baxi" | "remita" | "quickteller" | "billswift";
  /** Provider-specific payment code (used in payment requests). */
  paymentCode?: string;
  /** Whether the biller requires a fixed amount. */
  fixedAmount?: number;
  /** Customer reference field type. */
  customerRefType?: "meter" | "smartcard" | "iac" | "account" | "rrr" | "phone" | "id";
}

// ─── Category Mapping (TurboPay categories → provider categories) ───

const CATEGORY_LABELS: Record<string, string> = {
  electricity: "Electricity",
  internet: "Internet & Broadband",
  cable_tv: "Cable TV",
  airtime: "Airtime",
  data: "Data",
  education: "Education",
  insurance: "Insurance",
  government: "Government",
  betting: "Betting",
  water: "Water",
  others: "Others",
};

// ─── Baxi Billers (Electricity, Cable TV, Internet) ──────────

const BAXI_BILLERS: UnifiedBiller[] = [
  // Electricity
  { id: "baxi-ikedc", name: "Ikeja Electric (IKEDC)", category: "electricity", description: "Ikeja Electricity Distribution Company", provider: "baxi", customerRefType: "meter" },
  { id: "baxi-ekedc", name: "Eko Electricity (EKEDC)", category: "electricity", description: "Eko Electricity Distribution Company", provider: "baxi", customerRefType: "meter" },
  { id: "baxi-aedc", name: "Abuja Electric (AEDC)", category: "electricity", description: "Abuja Electricity Distribution Company", provider: "baxi", customerRefType: "meter" },
  { id: "baxi-ibedc", name: "Ibadan Electric (IBEDC)", category: "electricity", description: "Ibadan Electricity Distribution Company", provider: "baxi", customerRefType: "meter" },
  { id: "baxi-phed", name: "Port Harcourt Electric (PHED)", category: "electricity", description: "Port Harcourt Electricity Distribution Company", provider: "baxi", customerRefType: "meter" },
  { id: "baxi-eedc", name: "Enugu Electric (EEDC)", category: "electricity", description: "Enugu Electricity Distribution Company", provider: "baxi", customerRefType: "meter" },
  { id: "baxi-kedco", name: "Kano Electric (KEDCO)", category: "electricity", description: "Kano Electricity Distribution Company", provider: "baxi", customerRefType: "meter" },
  { id: "baxi-jedc", name: "Jos Electric (JEDC)", category: "electricity", description: "Jos Electricity Distribution Company", provider: "baxi", customerRefType: "meter" },
  { id: "baxi-bedc", name: "Benin Electric (BEDC)", category: "electricity", description: "Benin Electricity Distribution Company", provider: "baxi", customerRefType: "meter" },
  { id: "baxi-yedc", name: "Yola Electric (YEDC)", category: "electricity", description: "Yola Electricity Distribution Company", provider: "baxi", customerRefType: "meter" },

  // Cable TV
  { id: "baxi-dstv", name: "DStv", category: "cable_tv", description: "DStv satellite TV subscription", provider: "baxi", customerRefType: "smartcard" },
  { id: "baxi-gotv", name: "GOtv", category: "cable_tv", description: "GOtv digital TV subscription", provider: "baxi", customerRefType: "smartcard" },
  { id: "baxi-startimes", name: "StarTimes", category: "cable_tv", description: "StarTimes digital TV subscription", provider: "baxi", customerRefType: "smartcard" },
  { id: "baxi-showmax", name: "Showmax", category: "cable_tv", description: "Showmax streaming subscription", provider: "baxi", customerRefType: "account" },

  // Internet
  { id: "baxi-smile", name: "Smile Communications", category: "internet", description: "Smile broadband internet", provider: "baxi", customerRefType: "account" },
  { id: "baxi-spectranet", name: "Spectranet", category: "internet", description: "Spectranet broadband internet", provider: "baxi", customerRefType: "account" },
  { id: "baxi-fiberone", name: "FiberOne", category: "internet", description: "FiberOne fiber internet", provider: "baxi", customerRefType: "account" },
  { id: "baxi-airtel-broadband", name: "Airtel Broadband", category: "internet", description: "Airtel broadband internet", provider: "baxi", customerRefType: "account" },
  { id: "baxi-mtn-broadband", name: "MTN Broadband", category: "internet", description: "MTN broadband internet", provider: "baxi", customerRefType: "account" },
];

// ─── Remita Billers (Government, Education, Tax) ─────────────

const REMITA_BILLERS: UnifiedBiller[] = [
  { id: "remita-jamb", name: "JAMB", category: "education", description: "Joint Admissions and Matriculation Board", provider: "remita", customerRefType: "rrr" },
  { id: "remita-waec", name: "WAEC", category: "education", description: "West African Examinations Council", provider: "remita", customerRefType: "rrr" },
  { id: "remita-nimc", name: "NIMC", category: "government", description: "National Identity Management Commission", provider: "remita", customerRefType: "rrr" },
  { id: "remita-firs", name: "FIRS", category: "government", description: "Federal Inland Revenue Service", provider: "remita", customerRefType: "rrr" },
  { id: "remita-lasg", name: "Lagos State Government", category: "government", description: "Lagos State government payments", provider: "remita", customerRefType: "rrr" },
  { id: "remita-customs", name: "Nigeria Customs", category: "government", description: "Nigeria Customs Service", provider: "remita", customerRefType: "rrr" },
  { id: "remita-pencom", name: "PenCom", category: "government", description: "National Pension Commission", provider: "remita", customerRefType: "rrr" },
  { id: "remita-nhis", name: "NHIS", category: "insurance", description: "National Health Insurance Scheme", provider: "remita", customerRefType: "rrr" },
];

// ─── Quickteller Billers (Airtime, Data, TV, Electricity, Betting) ───

const QUICKTELLER_BILLERS: UnifiedBiller[] = [
  // Airtime
  { id: "qt-mtn-airtime", name: "MTN Airtime", category: "airtime", description: "MTN mobile airtime top-up", provider: "quickteller", paymentCode: "10401", customerRefType: "phone" },
  { id: "qt-glo-airtime", name: "GLO Airtime", category: "airtime", description: "GLO mobile airtime top-up", provider: "quickteller", paymentCode: "10402", customerRefType: "phone" },
  { id: "qt-airtel-airtime", name: "Airtel Airtime", category: "airtime", description: "Airtel mobile airtime top-up", provider: "quickteller", paymentCode: "10403", customerRefType: "phone" },
  { id: "qt-9mobile-airtime", name: "9mobile Airtime", category: "airtime", description: "9mobile airtime top-up", provider: "quickteller", paymentCode: "10404", customerRefType: "phone" },

  // Data
  { id: "qt-mtn-data", name: "MTN Data", category: "data", description: "MTN data bundle", provider: "quickteller", paymentCode: "10405", customerRefType: "phone" },
  { id: "qt-glo-data", name: "GLO Data", category: "data", description: "GLO data bundle", provider: "quickteller", paymentCode: "10406", customerRefType: "phone" },
  { id: "qt-airtel-data", name: "Airtel Data", category: "data", description: "Airtel data bundle", provider: "quickteller", paymentCode: "10407", customerRefType: "phone" },

  // Cable TV
  { id: "qt-dstv", name: "DStv", category: "cable_tv", description: "DStv subscription", provider: "quickteller", paymentCode: "10408", customerRefType: "smartcard" },
  { id: "qt-gotv", name: "GOtv", category: "cable_tv", description: "GOtv subscription", provider: "quickteller", paymentCode: "10409", customerRefType: "smartcard" },
  { id: "qt-startimes", name: "StarTimes", category: "cable_tv", description: "StarTimes subscription", provider: "quickteller", paymentCode: "10410", customerRefType: "smartcard" },

  // Electricity
  { id: "qt-ikedc", name: "Ikeja Electric", category: "electricity", description: "Ikeja Electricity Distribution", provider: "quickteller", paymentCode: "10411", customerRefType: "meter" },
  { id: "qt-ekedc", name: "Eko Electric", category: "electricity", description: "Eko Electricity Distribution", provider: "quickteller", paymentCode: "10412", customerRefType: "meter" },
  { id: "qt-ibedc", name: "Ibadan Electric", category: "electricity", description: "Ibadan Electricity Distribution", provider: "quickteller", paymentCode: "10413", customerRefType: "meter" },
  { id: "qt-phed", name: "Port Harcourt Electric", category: "electricity", description: "Port Harcourt Electricity Distribution", provider: "quickteller", paymentCode: "10414", customerRefType: "meter" },

  // Betting
  { id: "qt-bet9ja", name: "Bet9ja", category: "betting", description: "Bet9ja wallet funding", provider: "quickteller", paymentCode: "10415", customerRefType: "account" },
  { id: "qt-sportybet", name: "SportyBet", category: "betting", description: "SportyBet wallet funding", provider: "quickteller", paymentCode: "10416", customerRefType: "account" },

  // Education
  { id: "qt-waec", name: "WAEC", category: "education", description: "WAEC result checker", provider: "quickteller", paymentCode: "10417", customerRefType: "id" },
  { id: "qt-jamb", name: "JAMB", category: "education", description: "JAMB registration", provider: "quickteller", paymentCode: "10418", customerRefType: "id" },
];

// ─── BillSwift Billers (Utilities, Subscriptions) ────────────

const BILLSWIFT_BILLERS: UnifiedBiller[] = [
  { id: "bs-smile", name: "Smile Communications", category: "internet", description: "Smile broadband internet", provider: "billswift", customerRefType: "account" },
  { id: "bs-spectranet", name: "Spectranet", category: "internet", description: "Spectranet broadband internet", provider: "billswift", customerRefType: "account" },
  { id: "bs-dstv", name: "DStv", category: "cable_tv", description: "DStv subscription", provider: "billswift", customerRefType: "smartcard" },
  { id: "bs-gotv", name: "GOtv", category: "cable_tv", description: "GOtv subscription", provider: "billswift", customerRefType: "smartcard" },
  { id: "bs-startimes", name: "StarTimes", category: "cable_tv", description: "StarTimes subscription", provider: "billswift", customerRefType: "smartcard" },
  { id: "bs-lifeworth", name: "Lifeworth HMO", category: "insurance", description: "Lifeworth Health Insurance", provider: "billswift", customerRefType: "id" },
];

// ─── All Billers Combined ────────────────────────────────────

const ALL_BILLERS: UnifiedBiller[] = [
  ...BAXI_BILLERS,
  ...REMITA_BILLERS,
  ...QUICKTELLER_BILLERS,
  ...BILLSWIFT_BILLERS,
];

// ─── GET Handler ─────────────────────────────────────────────

export async function GET(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const url = new URL(req.url);
  const category = url.searchParams.get("category");

  if (category) {
    // Return billers for a specific category
    const billers = ALL_BILLERS.filter((b) => b.category === category);
    return json({
      data: {
        category,
        categoryLabel: CATEGORY_LABELS[category] ?? category,
        billers,
        totalProviders: [...new Set(billers.map((b) => b.provider))].length,
      },
    });
  }

  // Return all categories with their billers
  const categories = Object.keys(CATEGORY_LABELS).map((cat) => {
    const billers = ALL_BILLERS.filter((b) => b.category === cat);
    return {
      category: cat,
      label: CATEGORY_LABELS[cat],
      billerCount: billers.length,
      providers: [...new Set(billers.map((b) => b.provider))],
    };
  }).filter((c) => c.billerCount > 0);

  return json({
    data: {
      categories,
      totalBillers: ALL_BILLERS.length,
      totalProviders: 4,
    },
  });
}
