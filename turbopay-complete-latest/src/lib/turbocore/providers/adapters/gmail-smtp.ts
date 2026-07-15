/**
 * Gmail SMTP notification adapter (temporary).
 * ---------------------------------------------
 * Implements INotificationProvider using Gmail's free SMTP relay.
 *
 * This is a TEMPORARY provider for development and early production.
 * Replace with Resend / Termii / SendGrid when API keys are obtained.
 *
 * Gmail SMTP settings:
 *   Host: smtp.gmail.com
 *   Port: 465 (SSL) or 587 (STARTTLS)
 *   Auth: Gmail address + App Password (NOT your regular password)
 *
 * To generate an App Password:
 *   1. Go to https://myaccount.google.com/security
 *   2. Enable 2-Step Verification (required)
 *   3. Go to https://myaccount.google.com/apppasswords
 *   4. Generate an app password for "Mail"
 *   5. Use that 16-character password here
 *
 * Credentials (from ProviderConfig):
 *   - user: Gmail address (e.g. turbopay@gmail.com)
 *   - pass: App Password (16 chars, no spaces)
 *   - fromName: Display name (e.g. "Turbopay")
 */

import type {
  INotificationProvider,
  NotificationPayload,
  ProviderContext,
  ProviderResult,
} from "../interfaces";

export interface GmailSmtpCredentials {
  user: string;       // Gmail address
  pass: string;       // App Password
  fromName?: string;  // Display name (default: "Turbopay")
  fromEmail?: string; // From address (default: same as user)
}

// ─── Email templates ──────────────────────────────────────────

interface EmailTemplate {
  subject: string;
  html: (vars: Record<string, string | number>) => string;
}

const TEMPLATES: Record<string, EmailTemplate> = {
  "auth.otp": {
    subject: "Your Turbopay Verification Code",
    html: (v) => `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="color:#1a1a2e;font-size:24px;margin:0">Turbopay</h1>
        </div>
        <div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center">
          <p style="color:#555;font-size:14px;margin:0 0 16px">Your verification code is</p>
          <h2 style="color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:0 0 16px">${v.otp}</h2>
          <p style="color:#888;font-size:12px;margin:0">Valid for 10 minutes. Do not share this code.</p>
        </div>
        <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">
          If you didn't request this, ignore this email.
        </p>
      </div>
    `,
  },

  "auth.verify-email": {
    subject: "Verify Your Turbopay Account",
    html: (v) => `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="color:#1a1a2e;font-size:24px;margin:0">Turbopay</h1>
        </div>
        <div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center">
          <p style="color:#555;font-size:14px;margin:0 0 16px">Welcome to Turbopay! Verify your email address to get started.</p>
          ${v.verifyUrl
            ? `<a href="${v.verifyUrl}" style="display:inline-block;background:#1a1a2e;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:bold;margin:16px 0">Verify Email Address</a>
               <p style="color:#888;font-size:12px;margin:12px 0 0">Or enter this code: <strong>${v.otp}</strong></p>`
            : `<p style="color:#555;font-size:14px">Your verification code is:</p>
               <h2 style="color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:16px 0">${v.otp}</h2>`
          }
          <p style="color:#888;font-size:12px;margin:16px 0 0">Valid for 24 hours.</p>
        </div>
        <p style="color:#aaa;font-size:11px;text-align:center;margin-top:24px">
          If you didn't create this account, ignore this email.
        </p>
      </div>
    `,
  },

  "auth.forgot-password": {
    subject: "Reset Your Turbopay Password",
    html: (v) => `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="color:#1a1a2e;font-size:24px;margin:0">Turbopay</h1>
        </div>
        <div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center">
          <p style="color:#555;font-size:14px;margin:0 0 16px">You requested a password reset. Use the code below:</p>
          <h2 style="color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:16px 0">${v.otp}</h2>
          <p style="color:#888;font-size:12px;margin:16px 0 0">Valid for 10 minutes. If you didn't request this, secure your account immediately.</p>
        </div>
      </div>
    `,
  },

  "auth.forgot-pin": {
    subject: "Reset Your Turbopay Transaction PIN",
    html: (v) => `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="color:#1a1a2e;font-size:24px;margin:0">Turbopay</h1>
        </div>
        <div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center">
          <p style="color:#555;font-size:14px;margin:0 0 16px">Your PIN reset code is:</p>
          <h2 style="color:#1a1a2e;font-size:36px;letter-spacing:8px;margin:16px 0">${v.otp}</h2>
          <p style="color:#888;font-size:12px;margin:16px 0 0">Valid for 10 minutes.</p>
        </div>
      </div>
    `,
  },

  "transaction.debit": {
    subject: "Turbopay — Debit Alert",
    html: (v) => `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px">Debit Alert</h2>
        <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:16px;border-radius:8px">
          <p style="margin:0;font-size:24px;font-weight:bold;color:#ef4444">${v.amount}</p>
          <p style="margin:8px 0 0;color:#555;font-size:14px">${v.description}</p>
        </div>
        <p style="color:#888;font-size:12px;margin:16px 0 0">Balance: ${v.balance}</p>
      </div>
    `,
  },

  "transaction.credit": {
    subject: "Turbopay — Credit Alert",
    html: (v) => `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px">Credit Alert</h2>
        <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:16px;border-radius:8px">
          <p style="margin:0;font-size:24px;font-weight:bold;color:#22c55e">${v.amount}</p>
          <p style="margin:8px 0 0;color:#555;font-size:14px">${v.description}</p>
        </div>
        <p style="color:#888;font-size:12px;margin:16px 0 0">Balance: ${v.balance}</p>
      </div>
    `,
  },

  "generic": {
    subject: "Turbopay Notification",
    html: (v) => `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px">${v.title ?? "Notification"}</h2>
        <p style="color:#555;font-size:14px">${v.message ?? ""}</p>
      </div>
    `,
  },
};

export class GmailSmtpNotificationProvider implements INotificationProvider {
  readonly name = "gmail-smtp";
  private transporter: any = null;
  private readonly fromName: string;
  private readonly fromEmail: string;

  constructor(private readonly creds: GmailSmtpCredentials) {
    this.fromName = creds.fromName ?? "Turbopay";
    this.fromEmail = creds.fromEmail ?? creds.user;
  }

  private async getTransporter() {
    if (this.transporter) return this.transporter;

    const nodemailer = await import("nodemailer");
    this.transporter = nodemailer.default.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: this.creds.user,
        pass: this.creds.pass,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 5_000,
    });

    return this.transporter;
  }

  async send(
    payload: NotificationPayload,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ delivered: boolean; messageId?: string }>> {
    // Gmail SMTP only supports EMAIL channel.
    if (payload.channel !== "EMAIL") {
      return {
        ok: false,
        error: { code: "CHANNEL_UNSUPPORTED", message: "Gmail SMTP only supports EMAIL channel" },
      };
    }

    try {
      const transporter = await this.getTransporter();
      const template = TEMPLATES[payload.template] ?? TEMPLATES["generic"];
      const html = template.html(payload.variables);
      const subject = this.interpolate(template.subject, payload.variables);

      const info = await transporter.sendMail({
        from: `"${this.fromName}" <${this.fromEmail}>`,
        to: payload.to,
        subject,
        html,
        text: this.htmlToText(html),
        headers: {
          "X-Mailer": "Turbopay-GmailSMTP",
          "X-Turbopay-Template": payload.template,
          ...(payload.reference ? { "X-Turbopay-Reference": payload.reference } : {}),
        },
      });

      return {
        ok: true,
        data: { delivered: true, messageId: info.messageId },
        providerRef: info.messageId,
      };
    } catch (e) {
      return {
        ok: false,
        error: {
          code: "SMTP_ERROR",
          message: e instanceof Error ? e.message : "Failed to send email",
        },
      };
    }
  }

  private interpolate(template: string, vars: Record<string, string | number>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ""));
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}
