// TurboPay Admin Authentication Service
// Handles admin login, password recovery, and session management

import crypto from 'crypto';
import { sha256Hash, hmacSHA256 } from '../../utils/crypto';

// =============================================================================
// TYPES
// =============================================================================

export interface AdminUser {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
  role: 'master_admin' | 'admin' | 'staff';
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_email_verified: boolean;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  password_reset_token: string | null;
  password_reset_expires: Date | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  user?: Omit<AdminUser, 'password_hash' | 'salt' | 'password_reset_token' | 'password_reset_expires'>;
  error?: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetConfirm {
  token: string;
  new_password: string;
}

export interface ChangePasswordRequest {
  user_id: string;
  current_password: string;
  new_password: string;
}

// =============================================================================
// AUTH SERVICE
// =============================================================================

export class AdminAuthService {
  private users: Map<string, AdminUser> = new Map();
  private sessions: Map<string, { user_id: string; expires_at: Date }> = new Map();
  private readonly JWT_SECRET = process.env.JWT_SECRET || 'turbopay-jwt-secret-key-change-in-production';
  private readonly SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
  private readonly PASSWORD_RESET_EXPIRY = 60 * 60 * 1000; // 1 hour
  private readonly MASTER_ADMIN_EMAIL = 'Admin@okomba.com';

  constructor() {
    this.initializeMasterAdmin();
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  private initializeMasterAdmin(): void {
    const masterAdmin = this.createUser({
      email: this.MASTER_ADMIN_EMAIL,
      password: 'Admin@123456', // Default password - must be changed on first login
      first_name: 'Master',
      last_name: 'Admin',
      role: 'master_admin',
      created_by: null
    });
    console.log('[AuthService] Master admin initialized:', masterAdmin.email);
  }

  // ===========================================================================
  // USER MANAGEMENT
  // ===========================================================================

  createUser(params: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    role: 'master_admin' | 'admin' | 'staff';
    created_by: string | null;
  }): AdminUser {
    // Check if user already exists
    const existingUser = this.findUserByEmail(params.email);
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Generate salt and hash password
    const salt = crypto.randomBytes(16).toString('hex');
    const password_hash = this.hashPassword(params.password, salt);

    const user: AdminUser = {
      id: this.generateId(),
      email: params.email.toLowerCase(),
      password_hash,
      salt,
      role: params.role,
      first_name: params.first_name,
      last_name: params.last_name,
      is_active: true,
      is_email_verified: true,
      last_login: null,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: params.created_by,
      password_reset_token: null,
      password_reset_expires: null
    };

    this.users.set(user.id, user);
    return user;
  }

  findUserByEmail(email: string): AdminUser | undefined {
    for (const user of this.users.values()) {
      if (user.email === email.toLowerCase()) {
        return user;
      }
    }
    return undefined;
  }

  findUserById(id: string): AdminUser | undefined {
    return this.users.get(id);
  }

  getAllUsers(): Omit<AdminUser, 'password_hash' | 'salt' | 'password_reset_token' | 'password_reset_expires'>[] {
    return Array.from(this.users.values()).map(user => this.sanitizeUser(user));
  }

  updateUser(id: string, updates: Partial<AdminUser>): AdminUser | null {
    const user = this.users.get(id);
    if (!user) return null;

    const updatedUser = { ...user, ...updates, updated_at: new Date() };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  deleteUser(id: string): boolean {
    return this.users.delete(id);
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  async login(request: LoginRequest): Promise<LoginResponse> {
    const user = this.findUserByEmail(request.email);

    if (!user) {
      return { success: false, error: 'Invalid email or password' };
    }

    if (!user.is_active) {
      return { success: false, error: 'Account is disabled' };
    }

    const passwordValid = this.verifyPassword(request.password, user.salt, user.password_hash);
    if (!passwordValid) {
      return { success: false, error: 'Invalid email or password' };
    }

    // Update last login
    user.last_login = new Date();
    user.updated_at = new Date();
    this.users.set(user.id, user);

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
  }

  validateToken(token: string): AdminUser | null {
    const session = this.sessions.get(token);
    if (!session) return null;

    if (session.expires_at < new Date()) {
      this.sessions.delete(token);
      return null;
    }

    return this.findUserById(session.user_id) || null;
  }

  // ===========================================================================
  // PASSWORD MANAGEMENT
  // ===========================================================================

  async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    const user = this.findUserByEmail(email);
    if (!user) {
      // Don't reveal if user exists
      return { success: true, message: 'If an account exists with this email, you will receive a password reset link.' };
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + this.PASSWORD_RESET_EXPIRY);

    user.password_reset_token = resetToken;
    user.password_reset_expires = resetExpires;
    user.updated_at = new Date();
    this.users.set(user.id, user);

    // In production, send email here
    console.log(`[AuthService] Password reset token for ${email}: ${resetToken}`);

    return { 
      success: true, 
      message: 'If an account exists with this email, you will receive a password reset link.' 
    };
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    // Find user with this reset token
    let targetUser: AdminUser | null = null;
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

    // Update password
    const salt = crypto.randomBytes(16).toString('hex');
    targetUser.password_hash = this.hashPassword(newPassword, salt);
    targetUser.salt = salt;
    targetUser.password_reset_token = null;
    targetUser.password_reset_expires = null;
    targetUser.updated_at = new Date();
    this.users.set(targetUser.id, targetUser);

    return { success: true, message: 'Password has been reset successfully' };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    const user = this.findUserById(userId);
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    const valid = this.verifyPassword(currentPassword, user.salt, user.password_hash);
    if (!valid) {
      return { success: false, message: 'Current password is incorrect' };
    }

    // Update password
    const salt = crypto.randomBytes(16).toString('hex');
    user.password_hash = this.hashPassword(newPassword, salt);
    user.salt = salt;
    user.updated_at = new Date();
    this.users.set(user.id, user);

    return { success: true, message: 'Password changed successfully' };
  }

  async resetUserPassword(userId: string, newPassword: string, resetBy: string): Promise<{ success: boolean; message: string }> {
    const user = this.findUserById(userId);
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    // Only master admin can reset other admin passwords
    const adminUser = this.findUserById(resetBy);
    if (!adminUser || adminUser.role !== 'master_admin') {
      return { success: false, message: 'Only master admin can reset user passwords' };
    }

    // Update password
    const salt = crypto.randomBytes(16).toString('hex');
    user.password_hash = this.hashPassword(newPassword, salt);
    user.salt = salt;
    user.updated_at = new Date();
    this.users.set(user.id, user);

    return { success: true, message: 'Password reset successfully' };
  }

  // ===========================================================================
  // ROLE MANAGEMENT
  // ===========================================================================

  async updateUserRole(userId: string, newRole: 'admin' | 'staff', updatedBy: string): Promise<{ success: boolean; message: string }> {
    const user = this.findUserById(userId);
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    const adminUser = this.findUserById(updatedBy);
    if (!adminUser || adminUser.role !== 'master_admin') {
      return { success: false, message: 'Only master admin can change user roles' };
    }

    user.role = newRole;
    user.updated_at = new Date();
    this.users.set(user.id, user);

    return { success: true, message: `User role updated to ${newRole}` };
  }

  async toggleUserStatus(userId: string, updatedBy: string): Promise<{ success: boolean; message: string }> {
    const user = this.findUserById(userId);
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    const adminUser = this.findUserById(updatedBy);
    if (!adminUser || (adminUser.role !== 'master_admin' && adminUser.role !== 'admin')) {
      return { success: false, message: 'Insufficient permissions' };
    }

    user.is_active = !user.is_active;
    user.updated_at = new Date();
    this.users.set(user.id, user);

    return { success: true, message: `User ${user.is_active ? 'activated' : 'deactivated'}` };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private hashPassword(password: string, salt: string): string {
    return sha256Hash(password + salt);
  }

  private verifyPassword(password: string, salt: string, hash: string): boolean {
    return this.hashPassword(password, salt) === hash;
  }

  private generateId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private generateToken(user: AdminUser): string {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.SESSION_EXPIRY);

    this.sessions.set(sessionId, {
      user_id: user.id,
      expires_at: expiresAt
    });

    return sessionId;
  }

  private sanitizeUser(user: AdminUser): Omit<AdminUser, 'password_hash' | 'salt' | 'password_reset_token' | 'password_reset_expires'> {
    const { password_hash, salt, password_reset_token, password_reset_expires, ...sanitized } = user;
    return sanitized;
  }
}

export default AdminAuthService;
