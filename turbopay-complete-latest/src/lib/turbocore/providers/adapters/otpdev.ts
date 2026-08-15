/**
 * GetOTP (otp.dev) Notification Provider — temporary SMS adapter.
 * Implements INotificationProvider. Registered in adapter-factory.ts
 * when the admin configures an "otpdev" provider in Platform Settings.
 *
 * Key difference from Termii: GetOTP generates and sends the OTP itself.
 * The backend calls POST /v1/verifications with the phone number and template,
 * and GetOTP handles OTP generation, delivery, and expiry.
 *
 * For verification, use GET /v1/verifications?code={code}&phone={phone}.
 */
import { jsonRequest } from "./_http";
import type { INotificationProvider, NotificationPayload, ProviderResult } from "../interfaces";

export class OtpDevNotificationProvider implements INotificationProvider {
  readonly name = "otpdev";
  constructor(
    private readonly apiKey: string,
    private readonly senderId: string = "Turbopay",
    private readonly templateId?: string,
  ) {}

  async send(payload: NotificationPayload): Promise<ProviderResult<{ delivered: boolean; messageId?: string }>> {
    try {
      if (payload.channel === "EMAIL") {
        return { ok: false, error: { code: "UNSUPPORTED", message: "GetOTP does not support email — use Resend or Gmail SMTP" } };
      }
      return await this.sendSms(payload);
    } catch (err: any) {
      return { ok: false, error: { code: "DELIVERY_FAILED", message: err.message ?? "Unknown error" } };
    }
  }

  private async sendSms(payload: NotificationPayload): Promise<ProviderResult<{ delivered: boolean; messageId?: string }>> {
    // Build the OTP request body.
    // GetOTP generates the code itself — we pass the template and let it handle delivery.
    const body: Record<string, unknown> = {
      channel: "sms",
      sender: this.senderId,
      phone: payload.to,
    };

    // If we have a template ID configured, use it (GetOTP generates the code).
    // Otherwise, pass the code_length so GetOTP generates a 6-digit code.
    if (this.templateId) {
      body.template = this.templateId;
    } else {
      body.code_length = 6;
    }

    const res = await jsonRequest<{ data?: { message_id?: string }; message_id?: string }>({
      url: "https://api.otp.dev/v1/verifications",
      method: "POST",
      headers: {
        "X-OTP-Key": this.apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: { data: body },
      timeoutMs: 10_000,
    });

    const data = res.data;
    // GetOTP returns { data: { message_id: "..." } } (nested)
    const messageId = data?.data?.message_id ?? data?.message_id;
    return {
      ok: true as const,
      data: { delivered: true, messageId },
      providerRef: messageId,
    };
  }
}

/**
 * Verify an OTP code via GetOTP.
 * Returns true if the code is valid, false otherwise.
 */
export async function verifyOtpDev(
  apiKey: string,
  code: string,
  phone: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    const url = new URL("https://api.otp.dev/v1/verifications");
    url.searchParams.set("code", code);
    if (phone) url.searchParams.set("phone", phone);

    const res = await jsonRequest<{ data?: unknown[] }>({
      url: url.toString(),
      method: "GET",
      headers: {
        "X-OTP-Key": apiKey,
        "Accept": "application/json",
      },
      timeoutMs: 10_000,
    });

    // GetOTP returns { data: [...] } — empty array means invalid code
    const valid = Array.isArray(res.data.data) && res.data.data.length > 0;
    return { valid };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}
