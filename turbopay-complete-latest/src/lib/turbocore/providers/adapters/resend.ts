/**
 * Resend production adapter (email-only).
 * --------------------------------------
 * Implements INotificationProvider against the Resend email API.
 *
 * Credentials come from the adapter-factory (decrypted from the DB
 * ProviderConfig.credentialsEnc) — NEVER read from env vars here.
 * Expected credential keys: apiKey, baseUrl, fromEmail.
 *
 * Auth: `Authorization: Bearer <apiKey>` on every request.
 *
 * SMS / PUSH channels are rejected with a clear error — Resend is email-only.
 * Pair with the Termii adapter (SMS) when both channels are required.
 *
 * Templates: a minimal inline map covers the most common Turbopay
 * notifications. Unknown templates fall back to a generic subject + the raw
 * template name as the body so the contract still resolves.
 */
import type {
  INotificationProvider,
  NotificationPayload,
  ProviderContext,
  ProviderResult,
} from "../interfaces";
import { jsonRequest, toProviderError } from "./_http";

export interface ResendCredentials {
  apiKey: string;
  baseUrl: string;
  fromEmail: string;
}

interface ResendEmailResponse {
  id?: string;
  message_id?: string;
}

const SUBJECTS: Record<string, string> = {
  "auth.otp": "Your Turbopay Verification Code",
  "auth.verify-email": "Verify Your Turbopay Account",
  "auth.forgot-password": "Reset Your Turbopay Password",
  "auth.forgot-pin": "Reset Your Turbopay Transaction PIN",
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

const HTML_TEMPLATES: Record<string, string> = {
  "transaction.debit":
    "<p>Hi {{firstName}},</p><p>A debit of <strong>₦{{amount}}</strong> was made from your Turbopay wallet.</p><p>New balance: ₦{{balance}}<br/>Reference: {{ref}}</p>",
  "transaction.credit":
    "<p>Hi {{firstName}},</p><p>Your Turbopay wallet was credited with <strong>₦{{amount}}</strong>.</p><p>Reference: {{ref}}</p>",
  "auth.otp":
    "<p>Your Turbopay verification code is:</p><h2 style='letter-spacing:4px'>{{otp}}</h2><p>Valid for 10 minutes. Do not share this code with anyone.</p>",
  "auth.verify-email":
    "<div style='font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px'><div style='text-align:center;margin-bottom:24px'><h1 style='color:#1a1a2e;font-size:24px;margin:0'>Turbopay</h1></div><div style='background:#f8f9fa;border-radius:12px;padding:32px;text-align:center'><p style='color:#555;font-size:14px;margin:0 0 16px'>Welcome to Turbopay! Verify your email address to get started.</p>{{verifyUrl}}<p style='color:#555;font-size:14px'>Your verification code is:</p><h2 style='color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:16px 0'>{{otp}}</h2><p style='color:#888;font-size:12px;margin:16px 0 0'>Valid for 10 minutes.</p></div><p style='color:#aaa;font-size:11px;text-align:center;margin-top:24px'>If you didn't create this account, ignore this email.</p></div>",
  "auth.forgot-password":
    "<div style='font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px'><div style='text-align:center;margin-bottom:24px'><h1 style='color:#1a1a2e;font-size:24px;margin:0'>Turbopay</h1></div><div style='background:#f8f9fa;border-radius:12px;padding:32px;text-align:center'><p style='color:#555;font-size:14px;margin:0 0 16px'>You requested a password reset. Use the code below:</p><h2 style='color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:16px 0'>{{otp}}</h2><p style='color:#888;font-size:12px;margin:16px 0 0'>Valid for 10 minutes. If you didn't request this, secure your account immediately.</p></div></div>",
  "auth.forgot-pin":
    "<div style='font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px'><div style='text-align:center;margin-bottom:24px'><h1 style='color:#1a1a2e;font-size:24px;margin:0'>Turbopay</h1></div><div style='background:#f8f9fa;border-radius:12px;padding:32px;text-align:center'><p style='color:#555;font-size:14px;margin:0 0 16px'>Your PIN reset code is:</p><h2 style='color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:16px 0'>{{otp}}</h2><p style='color:#888;font-size:12px;margin:16px 0 0'>Valid for 10 minutes.</p></div></div>",
  "transaction.failed":
    "<p>Hi {{firstName}},</p><p>Your payment of <strong>₦{{amount}}</strong> failed. Reference: {{ref}}.</p>",
  "transaction.reversed":
    "<p>Hi {{firstName}},</p><p>₦{{amount}} has been reversed to your wallet. Reference: {{ref}}. New balance: ₦{{balance}}.</p>",
};

function render(template: string, vars: Record<string, string | number>): string {
  const html = HTML_TEMPLATES[template] ?? `<p>${template}</p><pre>{{payload}}</pre>`;
  let out = html;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(String(v));
  }
  return out;
}

export class ResendNotificationProvider implements INotificationProvider {
  readonly name = "resend";

  constructor(private readonly creds: ResendCredentials) {}

  async send(
    payload: NotificationPayload,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ delivered: boolean; messageId?: string }>> {
    if (payload.channel !== "EMAIL") {
      return {
        ok: false,
        error: { code: "CHANNEL_UNSUPPORTED", message: "resend is email-only" },
      };
    }
    try {
      const subject = SUBJECTS[payload.template] ?? "Turbopay Notification";
      const html = render(payload.template, payload.variables);
      const res = await jsonRequest<ResendEmailResponse>({
        url: `${this.creds.baseUrl}/emails`,
        method: "POST",
        headers: { Authorization: `Bearer ${this.creds.apiKey}` },
        body: {
          from: this.creds.fromEmail,
          to: payload.to,
          subject,
          html,
          ...(payload.reference ? { tags: [{ name: "reference", value: payload.reference }] } : {}),
        },
        idempotencyKey: ctx?.idempotencyKey ?? payload.reference,
      });
      const messageId = res.data.id ?? res.data.message_id;
      return { ok: true, data: { delivered: true, messageId }, providerRef: messageId, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "RESEND_ERROR") };
    }
  }
}
