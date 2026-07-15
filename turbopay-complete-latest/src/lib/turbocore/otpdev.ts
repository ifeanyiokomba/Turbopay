/**
 * GetOTP (otp.dev) SMS helper — sends OTPs via GetOTP API.
 *
 * Key difference from Termii: GetOTP generates and sends the OTP itself.
 * We don't generate the code or store a hash — GetOTP handles all of that.
 *
 * For SMS: call sendSmsOtp() → GetOTP sends the OTP → store message_id
 * For verification: call verifySmsOtp() → GetOTP checks the code
 *
 * GetOTP API:
 *   POST https://api.otp.dev/v1/verifications  (send)
 *   GET  https://api.otp.dev/v1/verifications?code={code}&phone={phone}  (verify)
 *
 * Auth: X-OTP-Key header with the API key.
 */

const OTPDEV_BASE_URL = "https://api.otp.dev/v1";

export interface OtpDevSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface OtpDevVerifyResult {
  ok: boolean;
  valid: boolean;
  error?: string;
}

/**
 * Send an SMS OTP via GetOTP.
 * GetOTP generates the code and sends it — we just provide the phone number.
 *
 * @param apiKey - GetOTP API key
 * @param phone - Phone number with country code (e.g., "2348012345678")
 * @param sender - Sender ID (optional, defaults to "Turbopay")
 * @param templateId - GetOTP template ID (optional, if not provided GetOTP uses code_length)
 * @param codeLength - OTP length 4-8 (optional, default 6, ignored if templateId provided)
 */
export async function sendSmsOtp(
  apiKey: string,
  phone: string,
  sender: string = "OTP Dev",
  templateId?: string,
  codeLength: number = 6,
): Promise<OtpDevSendResult> {
  try {
    const body: Record<string, unknown> = {
      channel: "sms",
      sender,
      phone,
    };

    if (templateId) {
      body.template = templateId;
      body.code_length = Math.min(Math.max(codeLength, 4), 8);
    } else {
      body.code_length = Math.min(Math.max(codeLength, 4), 8);
    }

    const res = await fetch(`${OTPDEV_BASE_URL}/verifications`, {
      method: "POST",
      headers: {
        "X-OTP-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ data: body }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, error: `GetOTP HTTP ${res.status}: ${errBody}` };
    }

    const data = await res.json() as any;
    // GetOTP wraps response in { data: { message_id, ... } }
    const msgId = data?.data?.message_id ?? data?.message_id;
    return { ok: true, messageId: msgId };
  } catch (e: any) {
    return { ok: false, error: e.message ?? "GetOTP send failed" };
  }
}

/**
 * Verify an SMS OTP via GetOTP.
 * Returns whether the code is valid.
 *
 * @param apiKey - GetOTP API key
 * @param code - The OTP code the user entered
 * @param phone - The phone number used for sending
 */
export async function verifySmsOtp(
  apiKey: string,
  code: string,
  phone: string,
): Promise<OtpDevVerifyResult> {
  try {
    const url = new URL(`${OTPDEV_BASE_URL}/verifications`);
    url.searchParams.set("code", code);
    if (phone) url.searchParams.set("phone", phone);

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-OTP-Key": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, valid: false, error: `GetOTP HTTP ${res.status}: ${errBody}` };
    }

    const data = await res.json() as any;
    // GetOTP returns { data: [...] } — empty array means invalid code
    const valid = Array.isArray(data.data) && data.data.length > 0;
    return { ok: true, valid };
  } catch (e: any) {
    return { ok: false, valid: false, error: e.message ?? "GetOTP verify failed" };
  }
}
