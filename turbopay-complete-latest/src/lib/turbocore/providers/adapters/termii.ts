/**
 * Termii Notification Provider — production-ready SMS + email adapter.
 * Implements INotificationProvider. Registered in adapter-factory.ts
 * when the admin configures a "termii" provider in Platform Settings.
 */
import type { INotificationProvider, NotificationPayload, ProviderResult } from "../interfaces";

export class TermiiNotificationProvider implements INotificationProvider {
  readonly name = "termii";
  constructor(
    private readonly apiKey: string,
    private readonly senderId: string = "Turbopay",
    private readonly resendApiKey?: string
  ) {}

  async send(payload: NotificationPayload): Promise<ProviderResult<{ delivered: boolean; messageId?: string }>> {
    const message = this.resolveTemplate(payload.template, payload.variables);
    try {
      if (payload.channel === "EMAIL" && this.resendApiKey) {
        return await this.sendEmail(payload, message);
      }
      return await this.sendSms(payload, message);
    } catch (err: any) {
      return { ok: false, error: { code: "DELIVERY_FAILED", message: err.message ?? "Unknown error" } };
    }
  }

  private async sendSms(payload: NotificationPayload, message: string) {
    const res = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, to: payload.to, from: this.senderId, sms: message, type: "plain", channel: "dnd" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false as const, error: { code: "TERMII_ERROR", message: `HTTP ${res.status}: ${body}` } };
    }
    const data = await res.json() as any;
    return { ok: true as const, data: { delivered: true, messageId: data.message_id }, providerRef: data.message_id };
  }

  private async sendEmail(payload: NotificationPayload, message: string) {
    const subject = this.getEmailSubject(payload.template);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "TurboPay <noreply@turbopay.okomba.com>", to: [payload.to], subject, text: message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false as const, error: { code: "RESEND_ERROR", message: `HTTP ${res.status}` } };
    const data = await res.json() as any;
    return { ok: true as const, data: { delivered: true, messageId: data.id }, providerRef: data.id };
  }

  private resolveTemplate(template: string, vars: Record<string, string | number>): string {
    const templates: Record<string, string> = {
      "auth.otp": "Your Turbopay verification code is {{otp}}. Valid for 10 minutes. Do not share this code.",
      "auth.kyc-approved": "Hi {{firstName}}, your Turbopay identity verification (Tier {{tier}}) has been approved.",
      "auth.kyc-rejected": "Hi {{firstName}}, your identity verification could not be completed. Reason: {{reason}}.",
      "transaction.debit": "Turbopay: Debit of ₦{{amount}}. Balance: ₦{{balance}}. Ref: {{ref}}.",
      "transaction.credit": "Turbopay: Credit of ₦{{amount}}. Ref: {{ref}}.",
      "transaction.failed": "Turbopay: Your payment of ₦{{amount}} failed. Ref: {{ref}}.",
      "transaction.reversed": "Turbopay: ₦{{amount}} reversed to your wallet. Ref: {{ref}}. Balance: ₦{{balance}}.",
      "pin.locked": "Turbopay: Your transaction PIN has been locked. Wait 15 minutes or contact support.",
      "wallet.frozen": "Turbopay: Your wallet has been restricted. Contact support@turbopay.com.",
      "wallet.unfrozen": "Turbopay: Your wallet restriction has been lifted.",
    };
    let msg = templates[template] ?? template;
    for (const [k, v] of Object.entries(vars)) msg = msg.replaceAll(`{{${k}}}`, String(v));
    return msg;
  }

  private getEmailSubject(template: string): string {
    const subjects: Record<string, string> = {
      "auth.otp": "Your Turbopay Verification Code",
      "auth.kyc-approved": "Identity Verification Approved — Turbopay",
      "auth.kyc-rejected": "Identity Verification Unsuccessful — Turbopay",
      "transaction.debit": "Turbopay Debit Notification",
      "transaction.credit": "Turbopay Credit Notification",
      "transaction.failed": "Turbopay Transaction Failed",
      "transaction.reversed": "Turbopay Reversal Notification",
      "pin.locked": "Transaction PIN Locked — Turbopay",
      "wallet.frozen": "Wallet Restricted — Turbopay",
      "wallet.unfrozen": "Wallet Restriction Lifted — Turbopay",
    };
    return subjects[template] ?? "Turbopay Notification";
  }
}
