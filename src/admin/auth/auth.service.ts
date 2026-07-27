// TurboPay Admin Authentication Service
// Handles admin login, password recovery, and session management

import crypto from 'crypto';
import { hashPassword as hashWithScrypt, verifyPassword as verifyWithScrypt } from '../../utils/crypto';
import { PersistenceManager } from '../../utils/persistence';
import { AdminRole, getPermissionsForRole, hasPermission as rbacHasPermission } from '../../rbac';

// =============================================================================
// TYPES
// =============================================================================

export type UserRole = AdminRole | 'master_admin' | 'admin' | 'staff';

export interface AdminUser {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
  role: UserRole;
  first_name: string;
  last_name: string;
  phone?: string;
  department?: string;
  job_title?: string;
  job_description?: string;
  onboarding_status: 'pending' | 'invited' | 'onboarded' | 'active';
  onboarding_completed_at?: Date;
  permissions: string[];
  reports_to?: string;
  is_active: boolean;
  is_email_verified: boolean;
  requires_password_change?: boolean;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  password_reset_token: string | null;
  password_reset_expires: Date | null;
  // Account lockout fields
  failed_login_attempts: number;
  locked_until: Date | null;
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
  private readonly JWT_SECRET: string;
  private readonly SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
  private readonly PASSWORD_RESET_EXPIRY = 60 * 60 * 1000; // 1 hour
  private persistence: PersistenceManager | null = null;
  private emailService: any = null; // EmailService (optional to avoid circular deps)
  public ready: Promise<void>;

  constructor(emailService?: any) {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('[AuthService] JWT_SECRET environment variable is required');
    }
    this.JWT_SECRET = jwtSecret;
    this.emailService = emailService || null;

    // Initialize master admin from environment variables if configured
    const adminEmail = process.env.MASTER_ADMIN_EMAIL;
    const adminPassword = process.env.MASTER_ADMIN_PASSWORD;
    if (adminEmail && adminPassword) {
      this.ready = this.initializeMasterAdmin(adminEmail, adminPassword).catch(err => {
        console.error('[AuthService] Failed to initialize master admin:', err);
      });
    } else {
      this.ready = Promise.resolve();
    }
  }

  /**
   * Set the email service (for dependency injection after construction).
   */
  setEmailService(emailService: any): void {
    this.emailService = emailService;
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  private async initializeMasterAdmin(email: string, password: string): Promise<void> {
    const existing = this.findUserByEmail(email);
    if (existing) return;

    await this.createUser({
      email,
      password,
      first_name: 'Master',
      last_name: 'Admin',
      role: 'master_admin',
      created_by: null
    });
    console.log('[AuthService] Master admin initialized');
  }

  registerPersistence(pm: PersistenceManager): void {
    this.persistence = pm;
    pm.register('admin_users', this.users);
    pm.register('admin_sessions', this.sessions);
  }

  // ===========================================================================
  // USER MANAGEMENT
  // ===========================================================================

  async createUser(params: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    role: UserRole;
    created_by: string | null;
    phone?: string;
    department?: string;
    job_title?: string;
    job_description?: string;
    permissions?: string[];
    reports_to?: string;
    onboarding_status?: 'pending' | 'invited' | 'onboarded' | 'active';
    requires_password_change?: boolean;
  }): Promise<AdminUser> {
    // Check if user already exists
    const existingUser = this.findUserByEmail(params.email);
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Generate salt and hash password
    const salt = crypto.randomBytes(16).toString('hex');
    const password_hash = await this.hashPassword(params.password, salt);

    const user: AdminUser = {
      id: this.generateId(),
      email: params.email.toLowerCase(),
      password_hash,
      salt,
      role: params.role,
      first_name: params.first_name,
      last_name: params.last_name,
      phone: params.phone,
      department: params.department,
      job_title: params.job_title,
      job_description: params.job_description,
      onboarding_status: params.onboarding_status || 'pending',
      permissions: params.permissions || [],
      reports_to: params.reports_to,
      is_active: true,
      is_email_verified: true,
      last_login: null,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: params.created_by,
      password_reset_token: null,
      password_reset_expires: null,
      failed_login_attempts: 0,
      locked_until: null
    };

    this.users.set(user.id, user);
    this.dirtyUsers();
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
    this.dirtyUsers();
    return updatedUser;
  }

  deleteUser(id: string): boolean {
    this.dirtyUsers();
    return this.users.delete(id);
  }

  // ===========================================================================
  // ONBOARDING
  // ===========================================================================

  /**
   * Invite a new admin — creates account with pending onboarding status.
   * Returns the admin user AND the temporary password (so the caller can display or email it).
   */
  async inviteAdmin(params: {
    email: string;
    first_name: string;
    last_name: string;
    role: UserRole;
    department: string;
    job_title: string;
    job_description: string;
    permissions?: string[];
    reports_to?: string;
    created_by: string;
  }): Promise<{ user: AdminUser; tempPassword: string }> {
    // Generate a temporary password — user will set their own during onboarding
    const tempPassword = crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16) + '!1';

    const user = await this.createUser({
      ...params,
      password: tempPassword,
      onboarding_status: 'invited',
      requires_password_change: true
    });

    // Send admin invite email if email service is available
    if (this.emailService) {
      try {
        const inviterUser = this.findUserById(params.created_by);
        const inviterName = inviterUser ? `${inviterUser.first_name} ${inviterUser.last_name}` : 'TurboPay Admin';
        await this.emailService.sendAdminInvite(
          user.email,
          user.first_name,
          inviterName,
          params.role,
          params.job_title,
          tempPassword
        );
        console.log(`[AuthService] Admin invite email sent to ${user.email}`);
      } catch (error) {
        console.error(`[AuthService] Failed to send admin invite email:`, error);
      }
    }

    console.log(`[AuthService] Admin invited: ${user.email} as ${params.job_title} (${params.department})`);
    return { user, tempPassword };
  }

  /**
   * Complete onboarding — user sets their password and finishes setup.
   * Properly hashes and stores the new password.
   */
  async completeOnboarding(userId: string, newPassword: string): Promise<AdminUser | null> {
    const user = this.users.get(userId);
    if (!user) return null;

    // Hash and set the new password
    const salt = crypto.randomBytes(16).toString('hex');
    user.password_hash = await this.hashPassword(newPassword, salt);
    user.salt = salt;
    user.requires_password_change = false;
    user.onboarding_status = 'active';
    user.onboarding_completed_at = new Date();
    user.updated_at = new Date();
    this.users.set(userId, user);
    this.dirtyUsers();
    return user;
  }

  /**
   * Get users by onboarding status
   */
  getUsersByOnboardingStatus(status: 'pending' | 'invited' | 'onboarded' | 'active'): Omit<AdminUser, 'password_hash' | 'salt' | 'password_reset_token' | 'password_reset_expires'>[] {
    return Array.from(this.users.values())
      .filter(u => u.onboarding_status === status)
      .map(u => this.sanitizeUser(u));
  }

  /**
   * Get users by department
   */
  getUsersByDepartment(department: string): Omit<AdminUser, 'password_hash' | 'salt' | 'password_reset_token' | 'password_reset_expires'>[] {
    return Array.from(this.users.values())
      .filter(u => u.department === department)
      .map(u => this.sanitizeUser(u));
  }

  /**
   * Check if user has a specific permission.
   * Uses the RBAC system for role-based permissions, combined with any
   * explicit permissions stored on the user record.
   */
  hasPermission(userId: string, permission: string): boolean {
    const user = this.users.get(userId);
    if (!user) return false;

    // Master admin and SUPER_ADMIN have all permissions
    if (user.role === 'master_admin' || user.role === 'SUPER_ADMIN') return true;

    // Check role-based permissions via RBAC system
    const rolePermissions = getPermissionsForRole(user.role as AdminRole);
    if (rolePermissions.includes(permission)) return true;

    // Check explicit permissions on user record
    return user.permissions.includes(permission);
  }

  /**
   * Get all permissions for a user (role-based + explicit).
   */
  getUserPermissions(userId: string): string[] {
    const user = this.users.get(userId);
    if (!user) return [];

    if (user.role === 'master_admin' || user.role === 'SUPER_ADMIN') {
      // Return a marker that indicates all permissions
      return ['*'];
    }

    const rolePermissions = getPermissionsForRole(user.role as AdminRole);
    const explicitPermissions = user.permissions || [];
    const combined = new Set([...rolePermissions, ...explicitPermissions]);
    return Array.from(combined);
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
        console.log(`[AuthService] Account locked for ${user.email} after ${user.failed_login_attempts} failed attempts`);
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

  validateToken(token: string): AdminUser | null {
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
    this.dirtyUsers();

    // Send password reset email if email service is available
    if (this.emailService) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const resetUrl = `${frontendUrl}/admin/reset-password?token=${resetToken}`;
      try {
        await this.emailService.sendPasswordResetEmail(
          user.email,
          user.first_name,
          resetUrl
        );
        console.log(`[AuthService] Password reset email sent to ${email}`);
      } catch (error) {
        console.error(`[AuthService] Failed to send password reset email:`, error);
      }
    } else {
      console.log(`[AuthService] Password reset requested for ${email} (email service not configured)`);
    }

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
    targetUser.password_hash = await this.hashPassword(newPassword, salt);
    targetUser.salt = salt;
    targetUser.password_reset_token = null;
    targetUser.password_reset_expires = null;
    targetUser.updated_at = new Date();
    this.users.set(targetUser.id, targetUser);

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

    // Update password
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
    user.password_hash = await this.hashPassword(newPassword, salt);
    user.salt = salt;
    user.updated_at = new Date();
    this.users.set(user.id, user);
    this.dirtyUsers();

    // Invalidate all existing sessions for this user — security best practice
    // so that stolen session tokens become useless after a password reset.
    this.invalidateUserSessions(user.id);

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
    this.dirtyUsers();

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
    this.dirtyUsers();

    return { success: true, message: `User ${user.is_active ? 'activated' : 'deactivated'}` };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private dirtyUsers(): void { this.persistence?.markDirty('admin_users'); }
  private dirtySessions(): void { this.persistence?.markDirty('admin_sessions'); }

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
      console.log(`[AuthService] Invalidated ${invalidated} session(s) for user ${userId}`);
    }
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

  private generateToken(user: AdminUser): string {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.SESSION_EXPIRY);

    this.sessions.set(sessionId, {
      user_id: user.id,
      expires_at: expiresAt
    });
    this.dirtySessions();

    return sessionId;
  }

  private sanitizeUser(user: AdminUser): Omit<AdminUser, 'password_hash' | 'salt' | 'password_reset_token' | 'password_reset_expires'> {
    const { password_hash, salt, password_reset_token, password_reset_expires, ...sanitized } = user;
    return sanitized;
  }
}

export default AdminAuthService;
