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
  // Registration / Sign-Up
  "auth.verify-email": "Confirm Your TurboPay Account Registration",
  // OTP verification
  "auth.otp": "Your TurboPay Verification Code",
  // Forgot Password
  "auth.forgot-password": "Reset Your TurboPay Password",
  // Forgot PIN
  "auth.forgot-pin": "Reset Your TurboPay Transaction PIN",
  // Admin team invite
  "admin.invite": "You've Been Invited to TurboPay Admin",
  // Login Verification
  "auth.login-otp": "Your TurboPay Login Verification Code",
  // Transaction Confirmation
  "transaction.confirm-otp": "Your TurboPay Transaction Confirmation Code",
  // Device Alert
  "auth.new-device": "New Device Access Alert — TurboPay",
  // KYC
  "auth.kyc-approved": "Identity Verification Approved — TurboPay",
  "auth.kyc-rejected": "Identity Verification Unsuccessful — Turbopay",
  // Transaction notifications
  "transaction.debit": "TurboPay — Debit Alert",
  "transaction.credit": "TurboPay — Credit Alert",
  "transaction.failed": "TurboPay — Transaction Failed",
  "transaction.reversed": "TurboPay — Reversal Notification",
  // Security
  "pin.locked": "Transaction PIN Locked — TurboPay",
  "wallet.frozen": "Wallet Restricted — TurboPay",
  "wallet.unfrozen": "Wallet Restriction Lifted — TurboPay",
};

const HTML_TEMPLATES: Record<string, string> = {
  // ─── Registration / Sign-Up OTP ────────────────────────────
  "auth.verify-email": `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="color:#1a1a2e;font-size:24px;margin:0">TurboPay</h1>
      </div>
      <div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center">
        <p style="color:#555;font-size:14px;margin:0 0 8px">Hello {{userName}},</p>
        <p style="color:#555;font-size:14px;margin:0 0 16px">Welcome to TurboPay! We are excited to have you onboard.</p>
        <p style="color:#555;font-size:14px;margin:0 0 16px">To complete your account registration, please enter the verification code below:</p>
        <h2 style="color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:16px 0">{{otp}}</h2>
        <p style="color:#888;font-size:12px;margin:16px 0 0">This verification code will expire in 5 minutes. For your security, do not share this code with anyone.</p>
      </div>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">If you did not request this registration, please ignore this message.</p>
      <p style="color:#aaa;font-size:11px;text-align:center">TurboPay Technologies Ltd</p>
    </div>`,

  // ─── Generic OTP (fallback) ────────────────────────────────
  "auth.otp": `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="color:#1a1a2e;font-size:24px;margin:0">TurboPay</h1>
      </div>
      <div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center">
        <p style="color:#555;font-size:14px;margin:0 0 16px">Hello {{userName}},</p>
        <p style="color:#555;font-size:14px;margin:0 0 16px">Your verification code is:</p>
        <h2 style="color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:16px 0">{{otp}}</h2>
        <p style="color:#888;font-size:12px;margin:16px 0 0">This code expires in 5 minutes. Do not share it with anyone.</p>
      </div>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">TurboPay Technologies Ltd</p>
    </div>`,

  // ─── Forgot Password OTP ───────────────────────────────────
  "auth.forgot-password": `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="color:#1a1a2e;font-size:24px;margin:0">TurboPay</h1>
      </div>
      <div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center">
        <p style="color:#555;font-size:14px;margin:0 0 8px">Hello {{userName}},</p>
        <p style="color:#555;font-size:14px;margin:0 0 16px">We received a request to reset your TurboPay account password.</p>
        <p style="color:#555;font-size:14px;margin:0 0 16px">To continue with the password reset process, enter the verification code below:</p>
        <h2 style="color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:16px 0">{{otp}}</h2>
        <p style="color:#888;font-size:12px;margin:16px 0 0">This verification code will expire in 5 minutes. For your security, do not share this code with anyone.</p>
      </div>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">If you did not request a password reset, please secure your account or contact TurboPay Support.</p>
      <p style="color:#aaa;font-size:11px;text-align:center">TurboPay Technologies Ltd</p>
    </div>`,

  // ─── Forgot PIN OTP ────────────────────────────────────────
  "auth.forgot-pin": `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="color:#1a1a2e;font-size:24px;margin:0">TurboPay</h1>
      </div>
      <div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center">
        <p style="color:#555;font-size:14px;margin:0 0 8px">Hello {{userName}},</p>
        <p style="color:#555;font-size:14px;margin:0 0 16px">Your TurboPay PIN reset code is:</p>
        <h2 style="color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:16px 0">{{otp}}</h2>
        <p style="color:#888;font-size:12px;margin:16px 0 0">This code expires in 5 minutes. Do not share it with anyone.</p>
      </div>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">If you did not request this, please contact TurboPay Support.</p>
      <p style="color:#aaa;font-size:11px;text-align:center">TurboPay Technologies Ltd</p>
    </div>`,

  // ─── Login Verification OTP ────────────────────────────────
  "auth.login-otp": `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="color:#1a1a2e;font-size:24px;margin:0">TurboPay</h1>
      </div>
      <div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center">
        <p style="color:#555;font-size:14px;margin:0 0 8px">Hello {{userName}},</p>
        <p style="color:#555;font-size:14px;margin:0 0 16px">Your TurboPay login verification code is:</p>
        <h2 style="color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:16px 0">{{otp}}</h2>
        <p style="color:#888;font-size:12px;margin:16px 0 0">This code expires in 5 minutes. Do not share it with anyone.</p>
      </div>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">If you did not attempt to log in, please secure your account immediately.</p>
      <p style="color:#aaa;font-size:11px;text-align:center">TurboPay Technologies Ltd</p>
    </div>`,

  // ─── Transaction Confirmation OTP ──────────────────────────
  "transaction.confirm-otp": `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="color:#1a1a2e;font-size:24px;margin:0">TurboPay</h1>
      </div>
      <div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center">
        <p style="color:#555;font-size:14px;margin:0 0 8px">Hello {{userName}},</p>
        <p style="color:#555;font-size:14px;margin:0 0 16px">Your TurboPay transaction confirmation code is:</p>
        <h2 style="color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:16px 0">{{otp}}</h2>
        <p style="color:#888;font-size:12px;margin:16px 0 0">Enter this code to authorize your transaction.</p>
        <p style="color:#888;font-size:12px;margin:8px 0 0">This code expires in 5 minutes. Never share your OTP with anyone.</p>
      </div>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">TurboPay Technologies Ltd</p>
    </div>`,

  // ─── New Device Login Alert ─────────────────────────────────
  "auth.new-device": `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="color:#1a1a2e;font-size:24px;margin:0">TurboPay</h1>
      </div>
      <div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center">
        <p style="color:#555;font-size:14px;margin:0 0 8px">Hello {{userName}},</p>
        <p style="color:#555;font-size:14px;margin:0 0 16px">A new device has been used to access your TurboPay account.</p>
        <p style="color:#555;font-size:14px;margin:0 0 8px"><strong>Device:</strong> {{deviceInfo}}</p>
        <p style="color:#555;font-size:14px;margin:0 0 8px"><strong>Location:</strong> {{ip}}</p>
        <p style="color:#555;font-size:14px;margin:0 0 16px"><strong>Time:</strong> {{timestamp}}</p>
      </div>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">If this was you, no action is required.</p>
      <p style="color:#aaa;font-size:11px;text-align:center">If you do not recognize this activity, please secure your account immediately.</p>
      <p style="color:#aaa;font-size:11px;text-align:center">TurboPay Technologies Ltd</p>
    </div>`,

  // ─── Admin Team Invite ──────────────────────────────────────
  "admin.invite": `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="color:#1a1a2e;font-size:24px;margin:0">TurboPay</h1>
      </div>
      <div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center">
        <p style="color:#555;font-size:14px;margin:0 0 8px">Hello {{userName}},</p>
        <p style="color:#555;font-size:14px;margin:0 0 16px"><strong>{{invitedByName}}</strong> has invited you to join the TurboPay admin team.</p>
        <p style="color:#555;font-size:14px;margin:0 0 16px">Your temporary password is:</p>
        <div style="background:#1a1a2e;border-radius:8px;padding:12px 24px;display:inline-block;margin:8px 0">
          <code style="color:#fff;font-size:18px;letter-spacing:2px">{{tempPassword}}</code>
        </div>
        <p style="color:#888;font-size:12px;margin:16px 0 0">You will be required to change this password on your first login.</p>
        <p style="color:#888;font-size:12px;margin:8px 0 0">For security, do not share this password with anyone.</p>
      </div>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">If you did not expect this invitation, please contact your administrator.</p>
      <p style="color:#aaa;font-size:11px;text-align:center">TurboPay Technologies Ltd</p>
    </div>`,

  // ─── Transaction Notifications ─────────────────────────────
  "transaction.debit": `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px">Debit Alert</h2>
      <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:16px;border-radius:8px">
        <p style="margin:0;font-size:24px;font-weight:bold;color:#ef4444">{{amount}}</p>
        <p style="margin:8px 0 0;color:#555;font-size:14px">{{description}}</p>
      </div>
      <p style="color:#888;font-size:12px;margin:16px 0 0">Balance: {{balance}}</p>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">TurboPay Technologies Ltd</p>
    </div>`,

  "transaction.credit": `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px">Credit Alert</h2>
      <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:16px;border-radius:8px">
        <p style="margin:0;font-size:24px;font-weight:bold;color:#22c55e">{{amount}}</p>
        <p style="margin:8px 0 0;color:#555;font-size:14px">{{description}}</p>
      </div>
      <p style="color:#888;font-size:12px;margin:16px 0 0">Reference: {{ref}}</p>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">TurboPay Technologies Ltd</p>
    </div>`,

  "transaction.failed": `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px">Transaction Failed</h2>
      <p style="color:#555;font-size:14px">Hi {{userName}},</p>
      <p style="color:#555;font-size:14px">Your payment of <strong>{{amount}}</strong> failed.</p>
      <p style="color:#888;font-size:12px;margin:16px 0 0">Reference: {{ref}}</p>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">TurboPay Technologies Ltd</p>
    </div>`,

  "transaction.reversed": `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px">Reversal Notification</h2>
      <p style="color:#555;font-size:14px">Hi {{userName}},</p>
      <p style="color:#555;font-size:14px">{{amount}} has been reversed to your wallet.</p>
      <p style="color:#888;font-size:12px;margin:16px 0 0">Reference: {{ref}}<br/>New balance: {{balance}}</p>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">TurboPay Technologies Ltd</p>
    </div>`,
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
