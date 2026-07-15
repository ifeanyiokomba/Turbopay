import { json } from "@/lib/turbopay/api";

const COUNTRIES = [
  { code: "US", name: "United States", currency: "USD", flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", currency: "GBP", flag: "🇬🇧" },
  { code: "EU", name: "European Union", currency: "EUR", flag: "🇪🇺" },
  { code: "CA", name: "Canada", currency: "CAD", flag: "🇨🇦" },
  { code: "AU", name: "Australia", currency: "AUD", flag: "🇦🇺" },
  { code: "KE", name: "Kenya", currency: "KES", flag: "🇰🇪" },
  { code: "GH", name: "Ghana", currency: "GHS", flag: "🇬🇭" },
  { code: "ZA", name: "South Africa", currency: "ZAR", flag: "🇿🇦" },
  { code: "NG", name: "Nigeria", currency: "NGN", flag: "🇳🇬" },
  { code: "IN", name: "India", currency: "INR", flag: "🇮🇳" },
  { code: "CN", name: "China", currency: "CNY", flag: "🇨🇳" },
  { code: "JP", name: "Japan", currency: "JPY", flag: "🇯🇵" },
  { code: "BR", name: "Brazil", currency: "BRL", flag: "🇧🇷" },
  { code: "MX", name: "Mexico", currency: "MXN", flag: "🇲🇽" },
  { code: "PH", name: "Philippines", currency: "PHP", flag: "🇵🇭" },
  { code: "AE", name: "United Arab Emirates", currency: "AED", flag: "🇦🇪" },
  { code: "SG", name: "Singapore", currency: "SGD", flag: "🇸🇬" },
  { code: "CH", name: "Switzerland", currency: "CHF", flag: "🇨🇭" },
];

/**
 * GET /api/intl/countries — list supported destination countries.
 */
export async function GET() {
  return json({ data: COUNTRIES });
}
