// TurboPay OTP Service
// Handles OTP generation, sending via otp.dev, verification, and template management
// Supports SMS and Email channels with configurable templates

import crypto from 'crypto';
import { PersistenceManager } from '../utils/persistence';

// =============================================================================
// TYPES
// =============================================================================

export type OTPChannel = 'sms' | 'email';
export type OTPPurpose = 'registration' | 'password_reset' | 'login' | 'transaction_confirmation' | 'device_alert' | 'kyc';

export interface OTPConfig {
  api_key: string;
  sender_id: string;
  templates?: Record<OTPPurpose, OTPTemplate>;
  code_length?: number;
  expiry_minutes?: number;
  max_attempts?: number;
  rate_limit_window_ms?: number;
  rate_limit_max?: number;
}

export interface OTPTemplate {
  sms?: string;
  email_subject?: string;
  email_body?: string;
}

export interface OTPRecord {
  id: string;
  phone?: string;
  email?: string;
  code: string;
  channel: OTPChannel;
  purpose: OTPPurpose;
  status: 'pending' | 'verified' | 'expired' | 'failed' | 'blocked';
  attempts: number;
  max_attempts: number;
  created_at: Date;
  expires_at: Date;
  verified_at?: Date;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, any>;
}

export interface SendOTPRequest {
  phone?: string;
  email?: string;
  channel: OTPChannel;
  purpose: OTPPurpose;
  template_id?: string;
  variables?: Record<string, string>;
  ip_address?: string;
  user_agent?: string;
}

export interface SendOTPResponse {
  success: boolean;
  otp_id?: string;
  message: string;
  expires_at?: Date;
}

export interface VerifyOTPRequest {
  otp_id: string;
  code: string;
  phone?: string;
  email?: string;
}

export interface VerifyOTPResponse {
  success: boolean;
  message: string;
  attempts_remaining?: number;
}

// =============================================================================
// DEFAULT TEMPLATES (from otps.txt specification)
// =============================================================================

const DEFAULT_TEMPLATES: Record<OTPPurpose, OTPTemplate> = {
  registration: {
    sms: 'Hello {firstname}, welcome to TurboPay. Your account verification OTP is: {otp}. This code expires in 5 minutes. Do not share it with anyone. - TurboPay Technologies Ltd',
    email_subject: 'Confirm Your TurboPay Account Registration',
    email_body: `Hello {firstname} {lastname},

Welcome to TurboPay! We are excited to have you onboard.

To complete your account registration, please enter the verification code below:

{otp}

This verification code will expire in 5 minutes. For your security, do not share this code with anyone.

If you did not request this registration, please ignore this message.

Best regards,
TurboPay Technologies Ltd`
  },
  password_reset: {
    sms: 'Hello {firstname}, your TurboPay password reset OTP is: {otp}. This code expires in 5 minutes. Do not share it with anyone. If you did not request this, please contact TurboPay Support. - TurboPay Technologies Ltd',
    email_subject: 'Reset Your TurboPay Password',
    email_body: `Hello {firstname} {lastname},

We received a request to reset your TurboPay account password.

To continue with the password reset process, enter the verification code below:

{otp}

This verification code will expire in 5 minutes. For your security, do not share this code with anyone.

If you did not request a password reset, please secure your account or contact TurboPay Support.

Best regards,
TurboPay Technologies Ltd`
  },
  login: {
    sms: 'Hello {firstname}, your TurboPay login verification code is: {otp}. This code expires in 5 minutes. Do not share it with anyone. If you did not attempt to log in, please secure your account immediately. - TurboPay Technologies Ltd',
    email_subject: 'Your TurboPay Login Verification Code',
    email_body: `Hello {firstname} {lastname},

Your TurboPay login verification code is: {otp}

This code expires in 5 minutes. Do not share it with anyone.

If you did not attempt to log in, please secure your account immediately.

Best regards,
TurboPay Technologies Ltd`
  },
  transaction_confirmation: {
    sms: 'Hello {firstname}, your TurboPay transaction confirmation code is: {otp}. Enter this code to authorize your transaction. This code expires in 5 minutes. Never share your OTP with anyone. - TurboPay Technologies Ltd',
    email_subject: 'TurboPay Transaction Confirmation',
    email_body: `Hello {firstname} {lastname},

Your TurboPay transaction confirmation code is: {otp}

Enter this code to authorize your transaction.

This code expires in 5 minutes. Never share your OTP with anyone.

Best regards,
TurboPay Technologies Ltd`
  },
  device_alert: {
    sms: 'Hello {firstname}, a new device has been used to access your TurboPay account. If this was you, no action is required. If you do not recognize this activity, please secure your account immediately. - TurboPay Technologies Ltd',
    email_subject: 'New Device Login Alert - TurboPay',
    email_body: `Hello {firstname} {lastname},

A new device has been used to access your TurboPay account.

If this was you, no action is required.

If you do not recognize this activity, please secure your account immediately.

Best regards,
TurboPay Technologies Ltd`
  },
  kyc: {
    sms: 'Hello {firstname}, your TurboPay KYC verification OTP is: {otp}. This code expires in 5 minutes. Do not share it with anyone. - TurboPay Technologies Ltd',
    email_subject: 'TurboPay KYC Verification',
    email_body: `Hello {firstname} {lastname},

Your TurboPay KYC verification OTP is: {otp}

This verification code will expire in 5 minutes. For your security, do not share this code with anyone.

Best regards,
TurboPay Technologies Ltd`
  }
};

// =============================================================================
// OTP SERVICE
// =============================================================================

export class OTPService {
  private records: Map<string, OTPRecord> = new Map();
  private rateLimits: Map<string, number[]> = new Map();
  private config: Required<OTPConfig>;
  private persistence: PersistenceManager | null = null;

  constructor(config: OTPConfig) {
    this.config = {
      code_length: 4,
      expiry_minutes: 5,
      max_attempts: 5,
      rate_limit_window_ms: 60000, // 1 minute
      rate_limit_max: 3,
      ...config,
      templates: { ...DEFAULT_TEMPLATES, ...config.templates }
    };
  }

  registerPersistence(pm: PersistenceManager): void {
    this.persistence = pm;
    pm.register('otp_records', this.records);
  }

  // ===========================================================================
  // SEND OTP
  // ===========================================================================

  async sendOTP(request: SendOTPRequest): Promise<SendOTPResponse> {
    // Validate request
    if (!request.phone && !request.email) {
      return { success: false, message: 'Phone or email is required' };
    }

    const identifier = request.phone || request.email || '';

    // Check rate limit
    if (this.isRateLimited(identifier)) {
      return { success: false, message: 'Too many requests. Please try again later.' };
    }

    // Check for existing pending OTP (reuse if within window)
    const existingOTP = this.findPendingOTP(identifier, request.purpose);
    if (existingOTP) {
      const timeSinceCreation = Date.now() - existingOTP.created_at.getTime();
      if (timeSinceCreation < 60000) { // Allow resend after 60 seconds
        return {
          success: false,
          message: 'Please wait before requesting a new code',
          expires_at: existingOTP.expires_at
        };
      }
      // Mark old OTP as expired
      existingOTP.status = 'expired';
    }

    // Generate OTP code
    const code = this.generateCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.expiry_minutes * 60000);

    // Create OTP record
    const record: OTPRecord = {
      id: this.generateId(),
      phone: request.phone,
      email: request.email,
      code: this.hashCode(code),
      channel: request.channel,
      purpose: request.purpose,
      status: 'pending',
      attempts: 0,
      max_attempts: this.config.max_attempts,
      created_at: now,
      expires_at: expiresAt,
      ip_address: request.ip_address,
      user_agent: request.user_agent,
      metadata: request.variables
    };

    this.records.set(record.id, record);
    this.dirty();

    // Record rate limit
    this.recordRateLimit(identifier);

    // Send OTP via channel
    try {
      if (request.channel === 'sms' && request.phone) {
        await this.sendSMS(request.phone, code, request.purpose, request.variables);
      } else if (request.channel === 'email' && request.email) {
        await this.sendEmail(request.email, code, request.purpose, request.variables);
      } else {
        return { success: false, message: 'Invalid channel or missing recipient' };
      }

      return {
        success: true,
        otp_id: record.id,
        message: `OTP sent successfully via ${request.channel}`,
        expires_at: expiresAt
      };
    } catch (error) {
      record.status = 'failed';
      this.dirty();
      console.error(`[OTPService] Failed to send OTP:`, (error as Error).message);
      return { success: false, message: 'Failed to send OTP. Please try again.' };
    }
  }

  // ===========================================================================
  // VERIFY OTP
  // ===========================================================================

  async verifyOTP(request: VerifyOTPRequest): Promise<VerifyOTPResponse> {
    const record = this.records.get(request.otp_id);

    if (!record) {
      return { success: false, message: 'Invalid OTP request' };
    }

    // Check if already verified
    if (record.status === 'verified') {
      return { success: false, message: 'OTP has already been used' };
    }

    // Check if expired
    if (record.expires_at < new Date()) {
      record.status = 'expired';
      this.dirty();
      return { success: false, message: 'OTP has expired. Please request a new one.' };
    }

    // Check if blocked
    if (record.status === 'blocked') {
      return { success: false, message: 'OTP is blocked. Please request a new one.' };
    }

    // Check max attempts
    if (record.attempts >= record.max_attempts) {
      record.status = 'blocked';
      this.dirty();
      return { success: false, message: 'Maximum verification attempts exceeded. Please request a new OTP.' };
    }

    // Increment attempts
    record.attempts++;

    // Verify code
    const hashedInput = this.hashCode(request.code);
    if (record.code !== hashedInput) {
      this.dirty();
      return {
        success: false,
        message: 'Invalid OTP code',
        attempts_remaining: record.max_attempts - record.attempts
      };
    }

    // Mark as verified
    record.status = 'verified';
    record.verified_at = new Date();
    this.dirty();

    return {
      success: true,
      message: 'OTP verified successfully'
    };
  }

  // ===========================================================================
  // SMS SENDING (via otp.dev)
  // ===========================================================================

  private async sendSMS(phone: string, code: string, purpose: OTPPurpose, variables?: Record<string, string>): Promise<void> {
    const template = this.config.templates[purpose];
    let message = template.sms || `Your TurboPay verification code is: {otp}. This code expires in ${this.config.expiry_minutes} minutes.`;

    // Replace variables
    message = message.replace('{otp}', code);
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
      }
    }

    // Send via otp.dev API
    const response = await fetch('https://api.otp.dev/v1/verifications', {
      method: 'POST',
      headers: {
        'X-OTP-Key': this.config.api_key,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: {
          channel: 'sms',
          sender: this.config.sender_id,
          phone: phone,
          template: this.getTemplateId(purpose),
          code_length: this.config.code_length
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SMS delivery failed: ${error}`);
    }
  }

  // ===========================================================================
  // EMAIL SENDING
  // ===========================================================================

  private async sendEmail(email: string, code: string, purpose: OTPPurpose, variables?: Record<string, string>): Promise<void> {
    const template = this.config.templates[purpose];
    let subject = template.email_subject || 'TurboPay Verification Code';
    let body = template.email_body || `Your verification code is: {otp}. This code expires in ${this.config.expiry_minutes} minutes.`;

    // Replace variables
    const replacements: Record<string, string> = {
      otp: code,
      ...variables
    };

    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      subject = subject.replace(regex, value);
      body = body.replace(regex, value);
    }

    // TODO: Integrate with email provider (SendGrid, AWS SES, etc.)
    // For now, log the email content
    console.log(`[OTPService] Email to ${email}:`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body: ${body.substring(0, 100)}...`);

    // Simulate email sending
    // In production, replace with actual email provider integration
  }

  // ===========================================================================
  // TEMPLATE MANAGEMENT
  // ===========================================================================

  getTemplate(purpose: OTPPurpose): OTPTemplate {
    return this.config.templates[purpose];
  }

  updateTemplate(purpose: OTPPurpose, template: Partial<OTPTemplate>): void {
    this.config.templates[purpose] = {
      ...this.config.templates[purpose],
      ...template
    };
  }

  getAllTemplates(): Record<OTPPurpose, OTPTemplate> {
    return { ...this.config.templates };
  }

  // ===========================================================================
  // ADMIN OPERATIONS
  // ===========================================================================

  getOTPStats(): {
    total: number;
    pending: number;
    verified: number;
    expired: number;
    failed: number;
    blocked: number;
  } {
    const records = Array.from(this.records.values());
    return {
      total: records.length,
      pending: records.filter(r => r.status === 'pending').length,
      verified: records.filter(r => r.status === 'verified').length,
      expired: records.filter(r => r.status === 'expired').length,
      failed: records.filter(r => r.status === 'failed').length,
      blocked: records.filter(r => r.status === 'blocked').length
    };
  }

  getRecentOTPs(limit: number = 50): OTPRecord[] {
    return Array.from(this.records.values())
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit)
      .map(r => ({ ...r, code: '****' })); // Mask code
  }

  invalidateAllForUser(identifier: string): number {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.phone === identifier || record.email === identifier) {
        if (record.status === 'pending') {
          record.status = 'expired';
          count++;
        }
      }
    }
    if (count > 0) this.dirty();
    return count;
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private generateCode(): string {
    const max = Math.pow(10, this.config.code_length) - 1;
    const min = Math.pow(10, this.config.code_length - 1);
    return crypto.randomInt(min, max + 1).toString();
  }

  private hashCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return `otp_${timestamp}_${random}`;
  }

  private findPendingOTP(identifier: string, purpose: OTPPurpose): OTPRecord | undefined {
    for (const record of this.records.values()) {
      if (
        (record.phone === identifier || record.email === identifier) &&
        record.purpose === purpose &&
        record.status === 'pending'
      ) {
        return record;
      }
    }
    return undefined;
  }

  private getTemplateId(purpose: OTPPurpose): string {
    // Map purpose to otp.dev template IDs
    // These should be configured per environment
    const templateMap: Record<OTPPurpose, string> = {
      registration: process.env.OTP_TEMPLATE_REGISTRATION || '',
      password_reset: process.env.OTP_TEMPLATE_PASSWORD_RESET || '',
      login: process.env.OTP_TEMPLATE_LOGIN || '',
      transaction_confirmation: process.env.OTP_TEMPLATE_TRANSACTION || '',
      device_alert: process.env.OTP_TEMPLATE_DEVICE_ALERT || '',
      kyc: process.env.OTP_TEMPLATE_KYC || ''
    };
    return templateMap[purpose] || '';
  }

  private isRateLimited(identifier: string): boolean {
    const timestamps = this.rateLimits.get(identifier) || [];
    const now = Date.now();
    const windowStart = now - this.config.rate_limit_window_ms;
    const recentRequests = timestamps.filter(t => t > windowStart);
    return recentRequests.length >= this.config.rate_limit_max;
  }

  private recordRateLimit(identifier: string): void {
    const timestamps = this.rateLimits.get(identifier) || [];
    timestamps.push(Date.now());
    // Keep only recent timestamps
    const now = Date.now();
    const windowStart = now - this.config.rate_limit_window_ms;
    const filtered = timestamps.filter(t => t > windowStart);
    this.rateLimits.set(identifier, filtered);
  }

  private dirty(): void {
    this.persistence?.markDirty('otp_records');
  }
}

export default OTPService;
