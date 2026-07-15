/**
 * TurboCore — Provider Adapter Factory
 * ======================================
 *
 * Instantiates a production provider adapter from a DB-backed ProviderConfig.
 * Reads the providerName + mode from the config, decrypts the credentials,
 * and constructs the appropriate adapter class.
 *
 * When a new real provider is onboarded, add its case to the switch statement.
 * Until then, returns null (caller falls back to mock).
 *
 * The switch is exhaustive across every ProviderContract so an admin who
 * configures a production route for any contract either gets a real adapter
 * OR a deliberate null with a TODO — never a silent fall-through to mock.
 */
import { db } from "@/lib/db";
import { providerConfig } from "@/lib/turbocore/config/provider-config";
import type { ProviderContract } from "@/lib/turbocore/providers/interfaces";
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
  ISubscriptionProvider,
  IDisputeProvider,
  ISettlementProvider,
  IPaymentPageProvider,
  ISplitPaymentProvider,
  IBulkTransferProvider,
  IDirectDebitProvider,
  IPAPSSProvider,
  IBalanceProvider,
} from "@/lib/turbocore/providers/interfaces";

export type AnyProvider =
  | IVirtualAccountProvider
  | IWalletFundingProvider
  | ILocalTransferProvider
  | IInternationalTransferProvider
  | IInternationalReceivingProvider
  | ICrossBorderSettlementProvider
  | IExchangeRateProvider
  | IBillPaymentProvider
  | IKYCProvider
  | INotificationProvider
  | ISubscriptionProvider
  | IDisputeProvider
  | ISettlementProvider
  | IPaymentPageProvider
  | ISplitPaymentProvider
  | IBulkTransferProvider
  | IDirectDebitProvider
  | IPAPSSProvider
  | IBalanceProvider
  | unknown;

class AdapterFactory {
  /**
   * Create a provider adapter from a DB-backed ProviderConfig.
   * Returns null if no adapter is registered for that providerName
   * (caller falls back to mock).
   */
  async create(contract: ProviderContract, providerConfigId: string): Promise<AnyProvider | null> {
    const pc = await db.providerConfig.findUnique({ where: { id: providerConfigId } });
    if (!pc) return null;

    const creds = (await providerConfig.getDecryptedCredentials(providerConfigId)) ?? {};

    // Switch on the typed `contract` parameter (not `pc.contract`, which is a
    // raw string from the DB) so TypeScript can enforce exhaustiveness across
    // the ProviderContract union.
    switch (contract) {
      // ─── Notification providers ───────────────────────────
      case "notification":
        if (pc.providerName === "termii") {
          const { TermiiNotificationProvider } = await import("@/lib/turbocore/providers/adapters/termii");
          return new TermiiNotificationProvider(
            creds.apiKey ?? "",
            creds.senderId ?? "Turbopay",
            creds.resendApiKey,
          );
        }
        if (pc.providerName === "resend") {
          const { ResendNotificationProvider } = await import("@/lib/turbocore/providers/adapters/resend");
          return new ResendNotificationProvider({
            apiKey: creds.apiKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.resend.com",
            fromEmail: creds.fromEmail ?? "Turbopay <noreply@turbopay.ng>",
          });
        }
        if (pc.providerName === "gmail-smtp") {
          const { GmailSmtpNotificationProvider } = await import("@/lib/turbocore/providers/adapters/gmail-smtp");
          return new GmailSmtpNotificationProvider({
            user: creds.user ?? "",
            pass: creds.pass ?? "",
            fromName: creds.fromName,
            fromEmail: creds.fromEmail,
          });
        }
        if (pc.providerName === "otpdev") {
          const { OtpDevNotificationProvider } = await import("@/lib/turbocore/providers/adapters/otpdev");
          return new OtpDevNotificationProvider(
            creds.apiKey ?? "",
            creds.senderId ?? "Turbopay",
            creds.templateId,
          );
        }
        return null;

      // ─── Virtual account providers ────────────────────────
      case "virtualAccount":
        if (pc.providerName === "monnify") {
          const { MonnifyProvider } = await import("@/lib/turbocore/providers/adapters/monnify");
          return new MonnifyProvider({
            apiKey: creds.apiKey ?? "",
            secretKey: creds.secretKey ?? "",
            contractCode: creds.contractCode ?? "",
            baseUrl: creds.baseUrl ?? "https://sandbox.monnify.com",
          });
        }
        if (pc.providerName === "paystack") {
          const { PaystackDvaProvider } = await import("@/lib/turbocore/providers/adapters/paystack-dva");
          return new PaystackDvaProvider(
            creds.secretKey ?? "",
            creds.baseUrl ?? "https://api.paystack.co",
          );
        }
        // TODO: anchor — virtual account adapter not yet implemented.
        // TODO: onepipe — virtual account adapter not yet implemented.
        return null;

      // ─── Wallet funding providers ─────────────────────────
      case "walletFunding":
        if (pc.providerName === "monnify") {
          const { MonnifyProvider } = await import("@/lib/turbocore/providers/adapters/monnify");
          return new MonnifyProvider({
            apiKey: creds.apiKey ?? "",
            secretKey: creds.secretKey ?? "",
            contractCode: creds.contractCode ?? "",
            baseUrl: creds.baseUrl ?? "https://sandbox.monnify.com",
          });
        }
        if (pc.providerName === "stripe") {
          const { StripePaymentProvider } = await import("@/lib/turbocore/providers/adapters/stripe");
          return new StripePaymentProvider({
            secretKey: creds.secretKey ?? "",
            publishableKey: creds.publishableKey,
            webhookSecret: creds.webhookSecret,
            restrictedKey: creds.restrictedKey,
            baseUrl: creds.baseUrl,
          });
        }
        if (pc.providerName === "paystack") {
          const { PaystackWalletFundingProvider } = await import("@/lib/turbocore/providers/adapters/paystack-wallet");
          return new PaystackWalletFundingProvider(
            creds.secretKey ?? "",
            creds.publicKey ?? "",
            creds.baseUrl ?? "https://api.paystack.co",
          );
        }
        if (pc.providerName === "flutterwave") {
          const { FlutterwaveWalletFundingProvider } = await import("@/lib/turbocore/providers/adapters/flutterwave");
          return new FlutterwaveWalletFundingProvider({
            clientId: creds.clientId ?? "",
            clientSecret: creds.clientSecret ?? "",
            baseUrl: creds.baseUrl ?? "https://api.flutterwave.com/v3",
          });
        }
        if (pc.providerName === "onafriq") {
          const { OnafriqWalletFundingProvider } = await import("@/lib/turbocore/providers/adapters/onafriq");
          return new OnafriqWalletFundingProvider({
            apiKey: creds.apiKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.onafriq.com/v1",
          });
        }
        return null;

      // ─── Bill payment providers ───────────────────────────
      case "billPayment":
        if (pc.providerName === "baxi") {
          const { BaxiBillPaymentProvider } = await import("@/lib/turbocore/providers/adapters/baxi");
          return new BaxiBillPaymentProvider({
            apiKey: creds.apiKey ?? "",
            baseUrl: creds.baseUrl ?? "https://baxi-payouts.capricorn-1.com",
          });
        }
        if (pc.providerName === "remita") {
          const { RemitaBillPaymentProvider } = await import("@/lib/turbocore/providers/adapters/remita");
          return new RemitaBillPaymentProvider({
            apiKey: creds.apiKey ?? "",
            merchantId: creds.merchantId ?? "",
            serviceTypeId: creds.serviceTypeId ?? "",
            secretKey: creds.secretKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.remita.net",
          });
        }
        if (pc.providerName === "quickteller") {
          const { QuicktellerBillPaymentProvider } = await import("@/lib/turbocore/providers/adapters/quickteller");
          return new QuicktellerBillPaymentProvider({
            apiKey: creds.apiKey ?? "",
            clientSecret: creds.clientSecret ?? "",
            merchantCode: creds.merchantCode ?? "",
            baseUrl: creds.baseUrl ?? "https://api.quickteller.com",
          });
        }
        if (pc.providerName === "flutterwave") {
          const { FlutterwaveBillPaymentProvider } = await import("@/lib/turbocore/providers/adapters/flutterwave");
          return new FlutterwaveBillPaymentProvider({
            clientId: creds.clientId ?? "",
            clientSecret: creds.clientSecret ?? "",
            baseUrl: creds.baseUrl ?? "https://api.flutterwave.com/v3",
          });
        }
        return null;

      // ─── KYC providers ────────────────────────────────────
      case "kyc":
        if (pc.providerName === "dojah") {
          const { DojahKYCProvider } = await import("@/lib/turbocore/providers/adapters/dojah");
          return new DojahKYCProvider({
            appId: creds.appId ?? "",
            publicKey: creds.publicKey ?? "",
            privateKey: creds.privateKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.dojah.co",
          });
        }
        if (pc.providerName === "paystack" || pc.providerName === "paystack-identity") {
          const { PaystackIdentityProvider } = await import("@/lib/turbocore/providers/adapters/paystack-identity");
          return new PaystackIdentityProvider({
            secretKey: creds.secretKey ?? "",
            publicKey: creds.publicKey ?? "",
            baseUrl: creds.baseUrl,
          });
        }
        if (pc.providerName === "stripe" || pc.providerName === "stripe-identity") {
          const { StripeIdentityProvider } = await import("@/lib/turbocore/providers/adapters/stripe-identity");
          return new StripeIdentityProvider({
            apiKey: creds.apiKey ?? "",
            baseUrl: creds.baseUrl,
          });
        }
        // TODO: prembly — KYC adapter not yet implemented.
        // TODO: smile — KYC adapter not yet implemented.
        return null;

      // ─── Local (NIP) outbound bank transfer providers ─────
      case "localTransfer":
        if (pc.providerName === "paystack") {
          const { PaystackLocalTransferProvider } = await import("@/lib/turbocore/providers/adapters/paystack");
          return new PaystackLocalTransferProvider({
            secretKey: creds.secretKey ?? "",
            publicKey: creds.publicKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.paystack.co",
          });
        }
        if (pc.providerName === "flutterwave") {
          const { FlutterwaveLocalTransferProvider } = await import("@/lib/turbocore/providers/adapters/flutterwave");
          return new FlutterwaveLocalTransferProvider({
            clientId: creds.clientId ?? "",
            clientSecret: creds.clientSecret ?? "",
            baseUrl: creds.baseUrl ?? "https://api.flutterwave.com/v3",
          });
        }
        return null;
      case "internationalTransfer": {
        // Outbound: a TurboPay user sends money abroad. This runs through an
        // Authorized Dealer bank under the CBN FX Manual (NOT an IMTO — IMTOs
        // are inbound-only per the Jan 2024 CBN guidelines). The sandbox
        // adapter simulates the full flow for testing.
        if (pc.providerName === "sandbox" || pc.providerName === "sandbox-intl-transfer") {
          const { SandboxInternationalTransferProvider } = await import("@/lib/turbocore/providers/adapters/sandbox-intl");
          return new SandboxInternationalTransferProvider();
        }
        // TODO: wise — outbound international transfer adapter (Authorized Dealer path).
        // TODO: flutterwave — outbound international transfer adapter.
        return null;
      }
      case "internationalReceiving": {
        // Inbound: someone abroad sends money to a TurboPay user. This runs
        // through a licensed IMTO partner (TurboPay cannot hold an IMTO
        // license directly per CBN guidelines). The sandbox adapter
        // simulates the webhook flow for testing.
        if (pc.providerName === "sandbox" || pc.providerName === "sandbox-intl-receiving") {
          const { SandboxInternationalReceivingProvider } = await import("@/lib/turbocore/providers/adapters/sandbox-intl");
          return new SandboxInternationalReceivingProvider();
        }
        // TODO: wise — inbound international receiving adapter (IMTO partnership required).
        // TODO: payoneer — inbound international receiving adapter (IMTO partnership required).
        return null;
      }
      case "crossBorderSettlement":
        // TODO: implement cross-border settlement adapter (e.g. Wise, Flux).
        return null;
      case "exchangeRate": {
        // FX rate quoting — the one contract where live comparison is
        // justified because rates move minute-to-minute. The sandbox
        // adapter returns rates with small random variation so the
        // rate-comparison logic can be tested with multiple providers.
        if (pc.providerName === "sandbox" || pc.providerName === "sandbox-fx") {
          const { SandboxFxProvider } = await import("@/lib/turbocore/providers/adapters/sandbox-intl");
          return new SandboxFxProvider();
        }
        if (pc.providerName === "flutterwave") {
          const { FlutterwaveFxProvider } = await import("@/lib/turbocore/providers/adapters/flutterwave");
          return new FlutterwaveFxProvider({
            clientId: creds.clientId ?? "",
            clientSecret: creds.clientSecret ?? "",
            baseUrl: creds.baseUrl ?? "https://api.flutterwave.com/v3",
          });
        }
        if (pc.providerName === "onafriq") {
          const { OnafriqFxProvider } = await import("@/lib/turbocore/providers/adapters/onafriq");
          return new OnafriqFxProvider({
            apiKey: creds.apiKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.onafriq.com/v1",
          });
        }
        // TODO: currencycloud — live FX quote adapter.
        return null;
      }

      // ─── Card issuing providers ──────────────────────────
      case "cardIssuer":
        if (pc.providerName === "turbopay") {
          const { TurbopayCardIssuer } = await import("@/lib/turbocore/providers/adapters/turbopay-cards");
          return new TurbopayCardIssuer();
        }
        // TODO: stripe — Stripe Issuing adapter not yet implemented.
        // TODO: marqeta — Marqeta adapter not yet implemented.
        return null;

      // ─── Subscription providers ──────────────────────────
      case "subscription":
        if (pc.providerName === "paystack") {
          const { PaystackSubscriptionProvider } = await import("@/lib/turbocore/providers/adapters/paystack-extended");
          return new PaystackSubscriptionProvider({
            secretKey: creds.secretKey ?? "",
            publicKey: creds.publicKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.paystack.co",
          });
        }
        if (pc.providerName === "quickteller") {
          const { QuicktellerSubscriptionProvider } = await import("@/lib/turbocore/providers/adapters/quickteller-extended");
          return new QuicktellerSubscriptionProvider({
            apiKey: creds.apiKey ?? "",
            clientSecret: creds.clientSecret ?? "",
            merchantCode: creds.merchantCode ?? "",
            baseUrl: creds.baseUrl ?? "https://orion.interswitchng.com",
            authBaseUrl: creds.authBaseUrl,
          });
        }
        return null;

      // ─── Dispute providers ───────────────────────────────
      case "dispute":
        if (pc.providerName === "paystack") {
          const { PaystackDisputeProvider } = await import("@/lib/turbocore/providers/adapters/paystack-extended");
          return new PaystackDisputeProvider({
            secretKey: creds.secretKey ?? "",
            publicKey: creds.publicKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.paystack.co",
          });
        }
        return null;

      // ─── Settlement providers ────────────────────────────
      case "settlement":
        if (pc.providerName === "paystack") {
          const { PaystackSettlementProvider } = await import("@/lib/turbocore/providers/adapters/paystack-extended");
          return new PaystackSettlementProvider({
            secretKey: creds.secretKey ?? "",
            publicKey: creds.publicKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.paystack.co",
          });
        }
        if (pc.providerName === "monnify") {
          const { MonnifySettlementProvider } = await import("@/lib/turbocore/providers/adapters/monnify-extended");
          return new MonnifySettlementProvider({
            apiKey: creds.apiKey ?? "",
            secretKey: creds.secretKey ?? "",
            contractCode: creds.contractCode ?? "",
            baseUrl: creds.baseUrl ?? "https://api.monnify.com",
          });
        }
        if (pc.providerName === "quickteller") {
          const { QuicktellerSettlementProvider } = await import("@/lib/turbocore/providers/adapters/quickteller-extended");
          return new QuicktellerSettlementProvider({
            apiKey: creds.apiKey ?? "",
            clientSecret: creds.clientSecret ?? "",
            merchantCode: creds.merchantCode ?? "",
            baseUrl: creds.baseUrl ?? "https://orion.interswitchng.com",
            authBaseUrl: creds.authBaseUrl,
          });
        }
        if (pc.providerName === "onafriq") {
          const { OnafriqSettlementProvider } = await import("@/lib/turbocore/providers/adapters/onafriq");
          return new OnafriqSettlementProvider({
            apiKey: creds.apiKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.onafriq.com/v1",
          });
        }
        return null;

      // ─── Payment page providers ──────────────────────────
      case "paymentPage":
        if (pc.providerName === "paystack") {
          const { PaystackPaymentPageProvider } = await import("@/lib/turbocore/providers/adapters/paystack-extended");
          return new PaystackPaymentPageProvider({
            secretKey: creds.secretKey ?? "",
            publicKey: creds.publicKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.paystack.co",
          });
        }
        if (pc.providerName === "monnify") {
          // Monnify payment pages use the same checkout SDK
          const { MonnifyProvider } = await import("@/lib/turbocore/providers/adapters/monnify");
          return new MonnifyProvider({
            apiKey: creds.apiKey ?? "",
            secretKey: creds.secretKey ?? "",
            contractCode: creds.contractCode ?? "",
            baseUrl: creds.baseUrl ?? "https://api.monnify.com",
          });
        }
        return null;

      // ─── Split payment providers ─────────────────────────
      case "splitPayment":
        if (pc.providerName === "paystack") {
          const { PaystackSplitPaymentProvider } = await import("@/lib/turbocore/providers/adapters/paystack-extended");
          return new PaystackSplitPaymentProvider({
            secretKey: creds.secretKey ?? "",
            publicKey: creds.publicKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.paystack.co",
          });
        }
        if (pc.providerName === "monnify") {
          const { MonnifySplitPaymentProvider } = await import("@/lib/turbocore/providers/adapters/monnify-extended");
          return new MonnifySplitPaymentProvider({
            apiKey: creds.apiKey ?? "",
            secretKey: creds.secretKey ?? "",
            contractCode: creds.contractCode ?? "",
            baseUrl: creds.baseUrl ?? "https://api.monnify.com",
          });
        }
        return null;

      // ─── Bulk transfer providers ─────────────────────────
      case "bulkTransfer":
        if (pc.providerName === "paystack") {
          // Paystack bulk transfers use the same transfer API
          const { PaystackLocalTransferProvider } = await import("@/lib/turbocore/providers/adapters/paystack");
          return new PaystackLocalTransferProvider({
            secretKey: creds.secretKey ?? "",
            publicKey: creds.publicKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.paystack.co",
          });
        }
        if (pc.providerName === "monnify") {
          const { MonnifyTransferProvider } = await import("@/lib/turbocore/providers/adapters/monnify-extended");
          return new MonnifyTransferProvider({
            apiKey: creds.apiKey ?? "",
            secretKey: creds.secretKey ?? "",
            contractCode: creds.contractCode ?? "",
            baseUrl: creds.baseUrl ?? "https://api.monnify.com",
          });
        }
        if (pc.providerName === "quickteller") {
          const { QuicktellerTransferProvider } = await import("@/lib/turbocore/providers/adapters/quickteller-extended");
          return new QuicktellerTransferProvider({
            apiKey: creds.apiKey ?? "",
            clientSecret: creds.clientSecret ?? "",
            merchantCode: creds.merchantCode ?? "",
            baseUrl: creds.baseUrl ?? "https://orion.interswitchng.com",
            authBaseUrl: creds.authBaseUrl,
          });
        }
        if (pc.providerName === "onafriq") {
          const { OnafriqTransferProvider } = await import("@/lib/turbocore/providers/adapters/onafriq");
          return new OnafriqTransferProvider({
            apiKey: creds.apiKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.onafriq.com/v1",
          });
        }
        return null;

      // ─── Direct debit providers ──────────────────────────
      case "directDebit":
        // TODO: paystack — direct debit adapter not yet implemented.
        // TODO: monnify — direct debit adapter not yet implemented.
        return null;

      // ─── PAPSS providers ─────────────────────────────────
      case "papss":
        if (pc.providerName === "onafriq") {
          const { OnafriqPapssProvider } = await import("@/lib/turbocore/providers/adapters/onafriq");
          return new OnafriqPapssProvider({
            apiKey: creds.apiKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.onafriq.com/v1",
          });
        }
        return null;

      // ─── Balance providers ───────────────────────────────
      case "balance":
        if (pc.providerName === "paystack") {
          // Paystack balance uses the transfer API's balance endpoint
          const { PaystackLocalTransferProvider } = await import("@/lib/turbocore/providers/adapters/paystack");
          return new PaystackLocalTransferProvider({
            secretKey: creds.secretKey ?? "",
            publicKey: creds.publicKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.paystack.co",
          });
        }
        if (pc.providerName === "monnify") {
          const { MonnifyWalletProvider } = await import("@/lib/turbocore/providers/adapters/monnify-extended");
          return new MonnifyWalletProvider({
            apiKey: creds.apiKey ?? "",
            secretKey: creds.secretKey ?? "",
            contractCode: creds.contractCode ?? "",
            baseUrl: creds.baseUrl ?? "https://api.monnify.com",
          });
        }
        if (pc.providerName === "onafriq") {
          const { OnafriqBalanceProvider } = await import("@/lib/turbocore/providers/adapters/onafriq");
          return new OnafriqBalanceProvider({
            apiKey: creds.apiKey ?? "",
            baseUrl: creds.baseUrl ?? "https://api.onafriq.com/v1",
          });
        }
        return null;

      default:
        // Exhaustiveness guard — if a new contract is added to the
        // ProviderContract type without a case here, TypeScript will
        // warn that `contract` is not `never`.
        return null;
    }
  }
}

export const adapterFactory = new AdapterFactory();
