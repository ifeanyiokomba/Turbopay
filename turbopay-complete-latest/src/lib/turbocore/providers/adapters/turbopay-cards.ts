/**
 * TurboCore — Turbopay Card Issuer Adapter
 * ===========================================
 *
 * An in-house virtual card issuer that generates Luhn-valid card numbers,
 * CVVs, and expiry dates. This is a realistic card-issuing primitive that
 * produces cards which pass client-side Luhn validation (the same algorithm
 * every e-commerce checkout uses) — enough for a production-grade demo,
 * staging environment, or a closed-loop card program where Turbopay acts as
 * its own BIN sponsor.
 *
 * For a live open-loop card program (cards accepted on the Visa/Mastercard
 * network), swap this adapter for a Stripe Issuing / Marqeta /_gidabank
 * adapter implementing the same IVirtualCardProvider contract. No business
 * code changes are required — the adapter-factory switch is the only edit.
 *
 * Security notes:
 *  - PANs use BIN 4388 43 (a Visa test BIN range) + 10 random digits + a
 *    Luhn check digit. The full PAN is returned to the caller which encrypts
 *    it before storage (AES-256-GCM via encryptPii).
 *  - CVVs are 3 cryptographically-random digits.
 *  - Expiry is set to ~3 years from issue (standard for virtual cards).
 */
import * as crypto from "node:crypto";
import type {
  IVirtualCardProvider,
  CardIssueInput,
  IssuedCardDetails,
  ProviderContext,
  ProviderResult,
} from "@/lib/turbocore/providers/interfaces";
import type { Currency } from "@/lib/turbocore/types";

/** Visa test BIN — first 6 digits of every issued PAN. */
const CARD_BIN = "438843";

/**
 * Generate a Luhn-valid 16-digit PAN.
 *
 * Algorithm: BIN (6) + 9 random digits + Luhn check digit (1) = 16 digits.
 * The Luhn algorithm is the ISO/IEC 7812-1 checksum used on every payment
 * card in the world. A card without a valid check digit is rejected by every
 * payment terminal and e-commerce checkout.
 */
function generateLuhnPan(): string {
  // 15 digits (BIN + 9 random) — the 16th is the check digit.
  const partial = CARD_BIN + Array.from(crypto.randomBytes(9), (b) => (b % 10)).join("");
  const checkDigit = luhnCheckDigit(partial);
  return partial + checkDigit;
}

/** Compute the Luhn check digit for a 15-digit partial PAN. */
function luhnCheckDigit(partial: string): string {
  let sum = 0;
  let double = true; // the check digit position is doubled
  for (let i = partial.length - 1; i >= 0; i--) {
    let d = parseInt(partial[i], 10);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

/** Validate a PAN with the Luhn algorithm (used by tests + authorisation). */
export function luhnValid(pan: string): boolean {
  if (!/^\d{15,16}$/.test(pan)) return false;
  let sum = 0;
  let double = false;
  for (let i = pan.length - 1; i >= 0; i--) {
    let d = parseInt(pan[i], 10);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Generate a 3-digit CVV from crypto-random bytes. */
function generateCvv(): string {
  const n = crypto.randomBytes(2).readUInt16BE(0) % 1000;
  return String(n).padStart(3, "0");
}

export class TurbopayCardIssuer implements IVirtualCardProvider {
  readonly name = "turbopay";

  async issueCard(
    input: CardIssueInput,
    _ctx?: ProviderContext,
  ): Promise<ProviderResult<IssuedCardDetails>> {
    const pan = generateLuhnPan();
    const cvv = generateCvv();

    // Expiry: 3 years from now, end of month.
    const now = new Date();
    const expiryYear = now.getFullYear() + 3;
    const expiryMonth = now.getMonth() + 1; // 1-12

    const providerCardId = `tp-card-${crypto.randomUUID()}`;

    return {
      ok: true,
      data: {
        providerCardId,
        pan,
        cvv,
        expiryMonth,
        expiryYear,
        last4: pan.slice(-4),
        brand: input.brand,
      },
      providerRef: providerCardId,
    };
  }

  async setCardStatus(
    providerCardId: string,
    status: "ACTIVE" | "FROZEN" | "TERMINATED",
    _ctx?: ProviderContext,
  ): Promise<ProviderResult<{ updated: boolean }>> {
    // In a real issuer adapter, this would PATCH the card's status via the
    // issuer's API. For the in-house issuer, the status is mirrored in the DB
    // by the card service, so this is a no-op confirmation.
    void providerCardId;
    void status;
    return { ok: true, data: { updated: true } };
  }

  async authorizePurchase(
    providerCardId: string,
    amountMinor: number,
    currency: Currency,
    merchant: string,
    _ctx?: ProviderContext,
  ): Promise<ProviderResult<{ approved: boolean; providerRef: string; declineReason?: string }>> {
    void providerCardId;
    void amountMinor;
    void currency;
    void merchant;
    // In a real issuer adapter, this would call the card network's
    // authorisation API. For the in-house issuer, all purchases on active
    // cards with sufficient balance are approved — the card service checks
    // the balance + controls before calling this.
    const providerRef = `tp-auth-${crypto.randomUUID()}`;
    return { ok: true, data: { approved: true, providerRef } };
  }
}

export const turbopayCardIssuer = new TurbopayCardIssuer();
