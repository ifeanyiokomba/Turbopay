// TurboPay Customer Authentication Service
// Handles customer registration, KYC verification, login, and session management
// Separate from admin auth — different interface, different capabilities

import crypto from 'crypto';
import { hashPassword as hashWithScrypt, verifyPassword as verifyWithScrypt } from '../utils/crypto';
import { PersistenceManager } from '../utils/persistence';

// =============================================================================
// TYPES
// =============================================================================

export type KYCTier = 'tier_1' | 'tier_2' | 'tier_3';

export interface CustomerUser {
  id: string;
  email: string;
  phone?: string;
  password_hash: string;
  salt: string;
  first_name: string;
  last_name: string;
  kyc_tier: KYCTier;
  bvn_verified: boolean;
  nin_verified: boolean;
  bvn?: string;
  nin?: string;
  is_active: boolean;
  is_email_verified: boolean;
  is_phone_verified: boolean;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
  password_reset_token: string | null;
  password_reset_expires: Date | null;
  // Account lockout fields
  failed_login_attempts: number;
  locked_until: Date | null;
}

export interface CustomerRegistrationRequest {
  email: string;
  phone?: string;
  password: string;
  first_name: string;
  last_name: string;
}

export interface CustomerLoginRequest {
  email: string;
  password: string;
}

export interface CustomerLoginResponse {
  success: boolean;
  token?: string;
  user?: Omit<CustomerUser, 'password_hash' | 'salt' | 'password_reset_token' | 'password_reset_expires'>;
  error?: string;
}

export interface KYCVerificationRequest {
  user_id: string;
  bvn?: string;
  nin?: string;
  verification_method: 'monnify' | 'flutterwave';
}

export interface KYCVerificationResponse {
  success: boolean;
  tier: KYCTier;
  verified_fields: string[];
  error?: string;
}

// =============================================================================
// CUSTOMER AUTH SERVICE
// =============================================================================

export class CustomerAuthService {
  private users: Map<string, CustomerUser> = new Map();
  private sessions: Map<string, { user_id: string; expires_at: Date }> = new Map();
  private readonly SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days
  private readonly PASSWORD_RESET_EXPIRY = 60 * 60 * 1000; // 1 hour
  private persistence: PersistenceManager | null = null;
  private emailService: any = null; // EmailService (optional)

  /**
   * Set the email service (for dependency injection after construction).
   */
  setEmailService(emailService: any): void {
    this.emailService = emailService;
  }

  registerPersistence(pm: PersistenceManager): void {
    this.persistence = pm;
    pm.register('customer_users', this.users);
    pm.register('customer_sessions', this.sessions);
  }

  // ===========================================================================
  // REGISTRATION
  // ===========================================================================

  async register(request: CustomerRegistrationRequest): Promise<{ success: boolean; user?: Omit<CustomerUser, 'password_hash' | 'salt' | 'password_reset_token' | 'password_reset_expires'>; error?: string }> {
    // Check if user already exists
    const existingUser = this.findUserByEmail(request.email);
    if (existingUser) {
      return { success: false, error: 'Email already registered' };
    }

    if (request.phone) {
      const existingPhone = this.findUserByPhone(request.phone);
      if (existingPhone) {
        return { success: false, error: 'Phone number already registered' };
      }
    }

    // Generate salt and hash password
    const salt = crypto.randomBytes(16).toString('hex');
    const password_hash = await this.hashPassword(request.password, salt);

    const user: CustomerUser = {
      id: this.generateId(),
      email: request.email.toLowerCase(),
      phone: request.phone,
      password_hash,
      salt,
      first_name: request.first_name,
      last_name: request.last_name,
      kyc_tier: 'tier_1',
      bvn_verified: false,
      nin_verified: false,
      is_active: true,
      is_email_verified: true,
      is_phone_verified: !!request.phone,
      last_login: null,
      created_at: new Date(),
      updated_at: new Date(),
      password_reset_token: null,
      password_reset_expires: null,
      failed_login_attempts: 0,
      locked_until: null
    };

    this.users.set(user.id, user);
    this.dirtyUsers();
    return { success: true, user: this.sanitizeUser(user) };
  }

  // ===========================================================================
  // LOGIN
  // ===========================================================================

  async login(request: CustomerLoginRequest): Promise<CustomerLoginResponse> {
    const user = this.findUserByEmail(request.email);

    if (!user) {
      return { success: false, error: 'Invalid email or password' };
    }

    if (!user.is_active) {
      return { success: false, error: 'Account is disabled' };
    }

    // Check account lockout
    const LOCKOUT_THRESHOLD = 5; // Failed attempts before lockout
    const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

    if (user.locked_until && user.locked_until > new Date()) {
      const minutesLeft = Math.ceil((user.locked_until.getTime() - Date.now()) / 60000);
      return { success: false, error: `Account is locked. Try again in ${minutesLeft} minutes` };
    }

    // If lockout expired, reset attempts
    if (user.locked_until && user.locked_until <= new Date()) {
      user.failed_login_attempts = 0;
      user.locked_until = null;
    }

    const passwordValid = await this.verifyPassword(request.password, user.salt, user.password_hash);
    if (!passwordValid) {
      // Track failed attempt
      user.failed_login_attempts = (user.failed_login_attempts || 0) + 1;
      if (user.failed_login_attempts >= LOCKOUT_THRESHOLD) {
        user.locked_until = new Date(Date.now() + LOCKOUT_DURATION);
        console.log(`[CustomerAuth] Account locked for ${user.email} after ${user.failed_login_attempts} failed attempts`);
      }
      user.updated_at = new Date();
      this.users.set(user.id, user);
      this.dirtyUsers();
      return { success: false, error: 'Invalid email or password' };
    }

    // Successful login — reset failed attempts
    user.failed_login_attempts = 0;
    user.locked_until = null;
    user.last_login = new Date();
    user.updated_at = new Date();
    this.users.set(user.id, user);
    this.dirtyUsers();

    // Generate session token
    const token = this.generateToken(user);

    return {
      success: true,
      token,
      user: this.sanitizeUser(user)
    };
  }

  async logout(token: string): Promise<void> {
    this.sessions.delete(token);
    this.dirtySessions();
  }

  validateToken(token: string): CustomerUser | null {
    const session = this.sessions.get(token);
    if (!session) return null;

    if (session.expires_at < new Date()) {
      this.sessions.delete(token);
      this.dirtySessions();
      return null;
    }

    return this.findUserById(session.user_id) || null;
  }

  // ===========================================================================
  // KYC VERIFICATION
  // ===========================================================================

  async verifyKYC(request: KYCVerificationRequest): Promise<KYCVerificationResponse> {
    const user = this.findUserById(request.user_id);
    if (!user) {
      return { success: false, tier: 'tier_1', verified_fields: [], error: 'User not found' };
    }

    const verifiedFields: string[] = [];

    // Verify BVN if provided
    if (request.bvn) {
      const bvnValid = await this.verifyBVN(request.bvn, request.verification_method);
      if (bvnValid) {
        user.bvn = request.bvn;
        user.bvn_verified = true;
        verifiedFields.push('bvn');
      }
    }

    // Verify NIN if provided
    if (request.nin) {
      const ninValid = await this.verifyNIN(request.nin, request.verification_method);
      if (ninValid) {
        user.nin = request.nin;
        user.nin_verified = true;
        verifiedFields.push('nin');
      }
    }

    // Determine KYC tier
    let tier: KYCTier = 'tier_1';
    if (user.bvn_verified && user.nin_verified) {
      tier = 'tier_3';
    } else if (user.bvn_verified || user.nin_verified) {
      tier = 'tier_2';
    }

    user.kyc_tier = tier;
    user.updated_at = new Date();
    this.users.set(user.id, user);
    this.dirtyUsers();

    return {
      success: true,
      tier,
      verified_fields: verifiedFields
    };
  }

  private async verifyBVN(bvn: string, method: 'monnify' | 'flutterwave'): Promise<boolean> {
    // Validate BVN format first (must be exactly 11 digits)
    if (!/^\d{11}$/.test(bvn)) {
      console.warn(`[CustomerAuth] Invalid BVN format: ${bvn}`);
      return false;
    }

    // Call the actual verification API
    try {
      if (method === 'monnify') {
        return await this.verifyBVNWithMonnify(bvn);
      } else {
        return await this.verifyBVNWithFlutterwave(bvn);
      }
    } catch (error) {
      console.error(`[CustomerAuth] BVN verification failed via ${method}:`, (error as Error).message);
      return false;
    }
  }

  private async verifyBVNWithMonnify(bvn: string): Promise<boolean> {
    const apiKey = process.env.MONNIFY_API_KEY;
    const apiSecret = process.env.MONNIFY_API_SECRET;
    if (!apiKey || !apiSecret) {
      console.warn('[CustomerAuth] Monnify credentials not configured — skipping BVN verification');
      return false;
    }

    // Get bearer token
    const tokenRes = await fetch('https://api.monnify.com/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, apiSecret }),
    });
    if (!tokenRes.ok) throw new Error('Monnify auth failed');
    const { responseBody } = await tokenRes.json() as any;
    const bearerToken = responseBody?.accessToken;
    if (!bearerToken) throw new Error('Monnify token missing');

    // Verify BVN
    const res = await fetch(`https://api.monnify.com/api/v2/verification/bvn/${bvn}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${bearerToken}` },
    });
    if (!res.ok) return false;
    const data = await res.json() as any;
    // Monnify returns requestSuccessful: true and data with bvn details
    return data?.requestSuccessful === true && !!data?.responseBody;
  }

  private async verifyBVNWithFlutterwave(bvn: string): Promise<boolean> {
    const secretKey = process.env.FLUTTERWAVE_V3_SECRET_KEY || process.env.FLUTTERWAVE_CLIENT_SECRET;
    if (!secretKey) {
      console.warn('[CustomerAuth] Flutterwave credentials not configured — skipping BVN verification');
      return false;
    }

    const res = await fetch('https://api.flutterwave.com/v3/bvn/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`,
      },
      body: JSON.stringify({ bvn }),
    });
    if (!res.ok) return false;
    const data = await res.json() as any;
    return data?.status === 'success' && !!data?.data;
  }

  private async verifyNIN(nin: string, method: 'monnify' | 'flutterwave'): Promise<boolean> {
    // Validate NIN format first (must be exactly 11 digits)
    if (!/^\d{11}$/.test(nin)) {
      console.warn(`[CustomerAuth] Invalid NIN format: ${nin}`);
      return false;
    }

    // Call the actual verification API
    try {
      if (method === 'monnify') {
        return await this.verifyNINWithMonnify(nin);
      } else {
        return await this.verifyNINWithFlutterwave(nin);
      }
    } catch (error) {
      console.error(`[CustomerAuth] NIN verification failed via ${method}:`, (error as Error).message);
      return false;
    }
  }

  private async verifyNINWithMonnify(nin: string): Promise<boolean> {
    const apiKey = process.env.MONNIFY_API_KEY;
    const apiSecret = process.env.MONNIFY_API_SECRET;
    if (!apiKey || !apiSecret) {
      console.warn('[CustomerAuth] Monnify credentials not configured — skipping NIN verification');
      return false;
    }

    // Get bearer token
    const tokenRes = await fetch('https://api.monnify.com/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, apiSecret }),
    });
    if (!tokenRes.ok) throw new Error('Monnify auth failed');
    const { responseBody } = await tokenRes.json() as any;
    const bearerToken = responseBody?.accessToken;
    if (!bearerToken) throw new Error('Monnify token missing');

    // Verify NIN
    const res = await fetch(`https://api.monnify.com/api/v2/verification/nin/${nin}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${bearerToken}` },
    });
    if (!res.ok) return false;
    const data = await res.json() as any;
    return data?.requestSuccessful === true && !!data?.responseBody;
  }

  private async verifyNINWithFlutterwave(nin: string): Promise<boolean> {
    const secretKey = process.env.FLUTTERWAVE_V3_SECRET_KEY || process.env.FLUTTERWAVE_CLIENT_SECRET;
    if (!secretKey) {
      console.warn('[CustomerAuth] Flutterwave credentials not configured — skipping NIN verification');
      return false;
    }

    const res = await fetch('https://api.flutterwave.com/v3/nin/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`,
      },
      body: JSON.stringify({ nin }),
    });
    if (!res.ok) return false;
    const data = await res.json() as any;
    return data?.status === 'success' && !!data?.data;
  }

  // ===========================================================================
  // PASSWORD MANAGEMENT
  // ===========================================================================

  async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    const user = this.findUserByEmail(email);
    if (!user) {
      return { success: true, message: 'If an account exists with this email, you will receive a password reset link.' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + this.PASSWORD_RESET_EXPIRY);

    user.password_reset_token = resetToken;
    user.password_reset_expires = resetExpires;
    user.updated_at = new Date();
    this.users.set(user.id, user);
    this.dirtyUsers();

    // Send password reset email if email service is available
    if (this.emailService) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
      try {
        await this.emailService.sendPasswordResetEmail(
          user.email,
          user.first_name,
          resetUrl
        );
        console.log(`[CustomerAuth] Password reset email sent to ${email}`);
      } catch (error) {
        console.error(`[CustomerAuth] Failed to send password reset email:`, error);
      }
    } else {
      console.log(`[CustomerAuth] Password reset requested for ${email} (email service not configured)`);
    }

    return {
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.'
    };
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    let targetUser: CustomerUser | null = null;
    for (const user of this.users.values()) {
      if (user.password_reset_token === token) {
        targetUser = user;
        break;
      }
    }

    if (!targetUser) {
      return { success: false, message: 'Invalid or expired reset token' };
    }

    if (!targetUser.password_reset_expires || targetUser.password_reset_expires < new Date()) {
      return { success: false, message: 'Reset token has expired' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    targetUser.password_hash = await this.hashPassword(newPassword, salt);
    targetUser.salt = salt;
    targetUser.password_reset_token = null;
    targetUser.password_reset_expires = null;
    targetUser.updated_at = new Date();
    this.users.set(targetUser.id, targetUser);
    this.dirtyUsers();

    // Invalidate all existing sessions for this user — security best practice
    // so that stolen session tokens become useless after a password reset.
    this.invalidateUserSessions(targetUser.id);

    return { success: true, message: 'Password has been reset successfully' };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    const user = this.findUserById(userId);
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    const valid = await this.verifyPassword(currentPassword, user.salt, user.password_hash);
    if (!valid) {
      return { success: false, message: 'Current password is incorrect' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    user.password_hash = await this.hashPassword(newPassword, salt);
    user.salt = salt;
    user.updated_at = new Date();
    this.users.set(user.id, user);
    this.dirtyUsers();

    // Invalidate all existing sessions for this user — security best practice
    // so that stolen session tokens become useless after a password change.
    this.invalidateUserSessions(user.id);

    return { success: true, message: 'Password changed successfully' };
  }

  // ===========================================================================
  // USER MANAGEMENT
  // ===========================================================================

  getCustomer(userId: string): Omit<CustomerUser, 'password_hash' | 'salt' | 'password_reset_token' | 'password_reset_expires'> | null {
    const user = this.findUserById(userId);
    return user ? this.sanitizeUser(user) : null;
  }

  updateCustomer(userId: string, updates: Partial<CustomerUser>): CustomerUser | null {
    const user = this.users.get(userId);
    if (!user) return null;

    const updatedUser = { ...user, ...updates, updated_at: new Date() };
    this.users.set(userId, updatedUser);
    this.dirtyUsers();
    return updatedUser;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private dirtyUsers(): void { this.persistence?.markDirty('customer_users'); }
  private dirtySessions(): void { this.persistence?.markDirty('customer_sessions'); }

  /**
   * Invalidate all active sessions for a user.
   * Called after password changes/resets so that stolen session tokens
   * become useless immediately.
   */
  private invalidateUserSessions(userId: string): void {
    let invalidated = 0;
    for (const [token, session] of this.sessions.entries()) {
      if (session.user_id === userId) {
        this.sessions.delete(token);
        invalidated++;
      }
    }
    if (invalidated > 0) {
      this.dirtySessions();
      console.log(`[CustomerAuth] Invalidated ${invalidated} session(s) for user ${userId}`);
    }
  }

  private findUserByEmail(email: string): CustomerUser | undefined {
    for (const user of this.users.values()) {
      if (user.email === email.toLowerCase()) {
        return user;
      }
    }
    return undefined;
  }

  private findUserByPhone(phone: string): CustomerUser | undefined {
    for (const user of this.users.values()) {
      if (user.phone === phone) {
        return user;
      }
    }
    return undefined;
  }

  private findUserById(id: string): CustomerUser | undefined {
    return this.users.get(id);
  }

  private async hashPassword(password: string, salt: string): Promise<string> {
    return hashWithScrypt(password, salt);
  }

  private async verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
    return verifyWithScrypt(password, salt, hash);
  }

  private generateId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private generateToken(user: CustomerUser): string {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.SESSION_EXPIRY);

    this.sessions.set(sessionId, {
      user_id: user.id,
      expires_at: expiresAt
    });
    this.dirtySessions();

    return sessionId;
  }

  private sanitizeUser(user: CustomerUser): Omit<CustomerUser, 'password_hash' | 'salt' | 'password_reset_token' | 'password_reset_expires'> {
    const { password_hash, salt, password_reset_token, password_reset_expires, ...sanitized } = user;
    return sanitized;
  }
}

export default CustomerAuthService;
