/**
 * TurboCore — International Transfer Sandbox Adapters
 * =====================================================
 *
 * Sandbox (mock) adapters for the international payment contracts:
 *  - `internationalTransfer` (outbound: Turbopay user sends money abroad)
 *  - `internationalReceiving` (inbound: someone abroad sends money to a Turbopay user)
 *  - `exchangeRate` (FX rate quoting for the above)
 *
 * These are NOT real provider integrations — they simulate the full flow so
 * the routing, rate comparison, hold/confirm/reverse pipeline, and webhook
 * handling can be tested end-to-end before any real IMTO partnership is in
 * place.
 *
 * ─── Regulatory context (why these are sandbox-only) ──────────────
 *
 * As of the CBN's January 2024 guidelines:
 *  - Fintech companies CANNOT hold an IMTO license directly — TurboPay can
 *    only offer inbound international receiving by PARTNERING with an
 *    already-licensed IMTO. That's a business relationship, not a code gap.
 *  - IMTOs are restricted to INBOUND transfers only. Outbound (a TurboPay
 *    user sending money abroad) runs through an Authorized Dealer bank
 *    under the CBN Foreign Exchange Manual — a structurally different
 *    regulatory path.
 *
 * `internationalTransfer` (outbound) and `internationalReceiving` (inbound)
 * are separate contracts precisely because they have different regulatory
 * paths. Don't merge them.
 *
 * When a real IMTO partnership is in place, plugging in the real adapter
 * should require NO changes to the routing or transaction logic — that's
 * the actual test of whether this abstraction was built correctly. The
 * real adapter goes in adapter-factory.ts as a new `case` under the
 * existing contract — nothing else changes.
 */

import * as crypto from "node:crypto";
import type {
  IInternationalTransferProvider,
  IInternationalReceivingProvider,
  IExchangeRateProvider,
  InternationalTransferInput,
  InternationalTransferResult,
  IntlReceivingEvent,
  FxQuote,
  ProviderContext,
  ProviderResult,
} from "@/lib/turbocore/providers/interfaces";
import type { Currency } from "@/lib/turbocore/types";

// ─── Sandbox FX Rate Provider ─────────────────────────────────

/**
 * Sandbox FX rate provider — returns rates with small random variation
 * around a base rate so the rate-comparison logic can be tested with
 * multiple configured providers (each returns a slightly different rate).
 *
 * The base rates are realistic mid-market approximations. The variation
 * (±0.5%) simulates the real-time movement that justifies live comparison.
 */
const BASE_RATES: Record<string, number> = {
  "USD→NGN": 1485.0,
  "GBP→NGN": 1890.0,
  "EUR→NGN": 1605.0,
  "USD→GHS": 14.8,
  "NGN→USD": 0.000673,
};

export class SandboxFxProvider implements IExchangeRateProvider {
  readonly name = "sandbox-fx";

  async getQuote(
    from: Currency,
    to: Currency,
    amountMinor: number,
    _ctx?: ProviderContext,
  ): Promise<ProviderResult<FxQuote>> {
    const pair = `${from}→${to}`;
    const base = BASE_RATES[pair];
    if (!base) {
      return {
        ok: false,
        error: { code: "UNSUPPORTED_PAIR", message: `Pair ${pair} not supported by sandbox FX provider` },
      };
    }

    // ±0.5% random variation — simulates real-time rate movement.
    const variation = (crypto.randomBytes(2).readUInt16BE(0) / 65535 - 0.5) * 0.01;
    const rate = Math.round((base * (1 + variation)) * 1_000_000) / 1_000_000;
    const providerFeeMinor = Math.round(amountMinor * 0.005); // 0.5% provider fee
    const platformFeeMinor = Math.round(amountMinor * 0.002); // 0.2% platform fee
    const destinationAmountMinor = Math.round(amountMinor * rate);

    return {
      ok: true,
      data: {
        from,
        to,
        rate,
        rateId: `sbx-fx-${crypto.randomUUID().slice(0, 8)}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        providerFeeMinor,
        platformFeeMinor,
      },
      providerRef: `sbx-fx-${Date.now()}`,
    };
  }
}

// ─── Sandbox International Transfer (outbound) ────────────────

/**
 * Sandbox outbound international transfer provider — simulates sending
 * money abroad. In production this would call an Authorized Dealer bank's
 * API under the CBN Foreign Exchange Manual (NOT an IMTO — IMTOs are
 * inbound-only per the Jan 2024 CBN guidelines).
 */
export class SandboxInternationalTransferProvider implements IInternationalTransferProvider {
  readonly name = "sandbox-intl-transfer";

  async send(
    input: InternationalTransferInput,
    _ctx?: ProviderContext,
  ): Promise<ProviderResult<InternationalTransferResult>> {
    // Simulate a successful transfer with a realistic provider reference.
    const providerRef = `sbx-intl-out-${crypto.randomUUID().slice(0, 12)}`;
    const destinationAmountMinor = Math.round(input.amountMinor * 1485); // USD→NGN sandbox rate

    return {
      ok: true,
      data: {
        providerRef,
        status: "PENDING", // transfers are async — a webhook updates this to SUCCESS later
        quotedRate: 1485.0,
        destinationAmountMinor,
        feesMinor: Math.round(input.amountMinor * 0.01), // 1% fee
        settlementCurrency: input.destinationCurrency,
      },
      providerRef,
    };
  }

  async getStatus(
    providerRef: string,
    _ctx?: ProviderContext,
  ): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    // Simulate: 80% success, 15% pending, 5% failed — realistic distribution.
    const rand = crypto.randomBytes(1)[0] / 255;
    const status = rand < 0.8 ? "SUCCESS" : rand < 0.95 ? "PENDING" : "FAILED";
    void providerRef;
    return { ok: true, data: { status } };
  }
}

// ─── Sandbox International Receiving (inbound) ────────────────

/**
 * Sandbox inbound international receiving provider — simulates receiving
 * money from abroad. In production this would be an IMTO partner's webhook
 * (TurboPay cannot hold an IMTO license directly per CBN guidelines).
 */
export class SandboxInternationalReceivingProvider implements IInternationalReceivingProvider {
  readonly name = "sandbox-intl-receiving";

  async parseWebhook(
    rawPayload: unknown,
    _headers: Record<string, string>,
    _ctx?: ProviderContext,
  ): Promise<ProviderResult<IntlReceivingEvent>> {
    // The sandbox expects a payload shaped like a real IMTO webhook.
    const data = rawPayload as Record<string, unknown>;
    const eventData = (data.eventData ?? data) as Record<string, unknown>;

    const providerRef = String(eventData.providerRef ?? eventData.transactionReference ?? `sbx-rcv-${crypto.randomUUID().slice(0, 8)}`);
    const sourceCurrency = String(eventData.sourceCurrency ?? "USD") as Currency;
    const sourceAmountMinor = Number(eventData.sourceAmountMinor ?? eventData.amount ?? 100_00);
    const destinationCurrency = String(eventData.destinationCurrency ?? "NGN") as Currency;
    const rate = Number(eventData.rate ?? 1485.0);
    const destinationAmountMinor = Number(eventData.destinationAmountMinor ?? Math.round(sourceAmountMinor * rate));
    const feesMinor = Number(eventData.feesMinor ?? 0);
    const beneficiaryAccount = String(eventData.beneficiaryAccount ?? "");
    const senderName = String((eventData.sender as Record<string, unknown>)?.name ?? "Unknown Sender");
    const senderCountry = String((eventData.sender as Record<string, unknown>)?.country ?? "US");
    const paidAt = String(eventData.paidAt ?? new Date().toISOString());

    return {
      ok: true,
      data: {
        providerRef,
        sourceCurrency,
        sourceAmountMinor,
        destinationCurrency,
        destinationAmountMinor,
        rate,
        feesMinor,
        beneficiaryAccount,
        sender: { name: senderName, country: senderCountry },
        paidAt,
      },
      providerRef,
    };
  }
}
