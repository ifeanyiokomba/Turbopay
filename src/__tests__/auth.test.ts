// TurboPay Auth Services — Unit Tests
// Covers: AdminAuthService and CustomerAuthService

import { AdminAuthService } from '../admin/auth/auth.service';
import { CustomerAuthService } from '../auth/customer-auth.service';

// Set required env var before importing
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';

describe('AdminAuthService', () => {
  let auth: AdminAuthService;

  beforeEach(() => {
    auth = new AdminAuthService();
  });

  describe('Constructor', () => {
    test('throws if JWT_SECRET is not set', () => {
      const orig = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      expect(() => new AdminAuthService()).toThrow('JWT_SECRET');
      process.env.JWT_SECRET = orig;
    });

    test('creates successfully with JWT_SECRET set', () => {
      expect(auth).toBeDefined();
    });
  });

  describe('User Creation', () => {
    test('createUser creates a user with hashed password', async () => {
      const user = await auth.createUser({
        email: 'admin@test.com',
        password: 'SecurePass123!',
        first_name: 'Test',
        last_name: 'Admin',
        role: 'admin',
        created_by: null,
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('admin@test.com');
      expect(user.password_hash).toBeDefined();
      expect(user.password_hash).not.toBe('SecurePass123!');
      expect(user.salt).toBeDefined();
      expect(user.role).toBe('admin');
      expect(user.is_active).toBe(true);
    });

    test('createUser normalizes email to lowercase', async () => {
      const user = await auth.createUser({
        email: 'ADMIN@Test.COM',
        password: 'pass',
        first_name: 'A',
        last_name: 'B',
        role: 'staff',
        created_by: null,
      });
      expect(user.email).toBe('admin@test.com');
    });

    test('createUser rejects duplicate email', async () => {
      await auth.createUser({
        email: 'dup@test.com',
        password: 'pass',
        first_name: 'A',
        last_name: 'B',
        role: 'admin',
        created_by: null,
      });

      await expect(
        auth.createUser({
          email: 'dup@test.com',
          password: 'pass2',
          first_name: 'C',
          last_name: 'D',
          role: 'staff',
          created_by: null,
        })
      ).rejects.toThrow('already exists');
    });
  });

  describe('Login & Logout', () => {
    test('login succeeds with correct credentials', async () => {
      await auth.createUser({
        email: 'login@test.com',
        password: 'correct',
        first_name: 'L',
        last_name: 'I',
        role: 'admin',
        created_by: null,
      });

      const result = await auth.login({ email: 'login@test.com', password: 'correct' });
      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.user!.email).toBe('login@test.com');
    });

    test('login fails with wrong password', async () => {
      await auth.createUser({
        email: 'wrong@test.com',
        password: 'correct',
        first_name: 'W',
        last_name: 'R',
        role: 'admin',
        created_by: null,
      });

      const result = await auth.login({ email: 'wrong@test.com', password: 'incorrect' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid email or password');
    });

    test('login fails for non-existent user', async () => {
      const result = await auth.login({ email: 'nobody@test.com', password: 'pass' });
      expect(result.success).toBe(false);
    });

    test('login fails for disabled user', async () => {
      const user = await auth.createUser({
        email: 'disabled@test.com',
        password: 'pass',
        first_name: 'D',
        last_name: 'X',
        role: 'staff',
        created_by: null,
      });
      auth.updateUser(user.id, { is_active: false });

      const result = await auth.login({ email: 'disabled@test.com', password: 'pass' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Account is disabled');
    });

    test('logout invalidates the token', async () => {
      await auth.createUser({
        email: 'logout@test.com',
        password: 'pass',
        first_name: 'L',
        last_name: 'O',
        role: 'admin',
        created_by: null,
      });

      const loginResult = await auth.login({ email: 'logout@test.com', password: 'pass' });
      expect(loginResult.token).toBeDefined();

      await auth.logout(loginResult.token!);
      const validated = auth.validateToken(loginResult.token!);
      expect(validated).toBeNull();
    });
  });

  describe('Token Validation', () => {
    test('validateToken returns user for valid token', async () => {
      await auth.createUser({
        email: 'token@test.com',
        password: 'pass',
        first_name: 'T',
        last_name: 'K',
        role: 'admin',
        created_by: null,
      });

      const loginResult = await auth.login({ email: 'token@test.com', password: 'pass' });
      const user = auth.validateToken(loginResult.token!);
      expect(user).not.toBeNull();
      expect(user!.email).toBe('token@test.com');
    });

    test('validateToken returns null for invalid token', () => {
      expect(auth.validateToken('nonexistent')).toBeNull();
    });
  });

  describe('Password Management', () => {
    test('changePassword succeeds with correct current password', async () => {
      const user = await auth.createUser({
        email: 'cp@test.com',
        password: 'oldpass',
        first_name: 'C',
        last_name: 'P',
        role: 'admin',
        created_by: null,
      });

      const result = await auth.changePassword(user.id, 'oldpass', 'newpass');
      expect(result.success).toBe(true);

      // Verify new password works
      const login = await auth.login({ email: 'cp@test.com', password: 'newpass' });
      expect(login.success).toBe(true);
    });

    test('changePassword fails with wrong current password', async () => {
      const user = await auth.createUser({
        email: 'cp2@test.com',
        password: 'correct',
        first_name: 'C',
        last_name: 'P',
        role: 'admin',
        created_by: null,
      });

      const result = await auth.changePassword(user.id, 'wrong', 'newpass');
      expect(result.success).toBe(false);
    });

    test('requestPasswordReset returns generic message', async () => {
      await auth.createUser({
        email: 'reset@test.com',
        password: 'pass',
        first_name: 'R',
        last_name: 'S',
        role: 'admin',
        created_by: null,
      });

      const result = await auth.requestPasswordReset('reset@test.com');
      expect(result.success).toBe(true);
      // Security: same message whether user exists or not
      const result2 = await auth.requestPasswordReset('nonexistent@test.com');
      expect(result2.message).toBe(result.message);
    });

    test('confirmPasswordReset fails with invalid token', async () => {
      const result = await auth.confirmPasswordReset('badtoken', 'newpass');
      expect(result.success).toBe(false);
    });
  });

  describe('User Management', () => {
    test('getAllUsers excludes sensitive fields', async () => {
      await auth.createUser({
        email: 'list@test.com',
        password: 'pass',
        first_name: 'L',
        last_name: 'S',
        role: 'admin',
        created_by: null,
      });

      const users = auth.getAllUsers();
      expect(users.length).toBe(1);
      expect((users[0] as any).password_hash).toBeUndefined();
      expect((users[0] as any).salt).toBeUndefined();
      expect((users[0] as any).password_reset_token).toBeUndefined();
    });

    test('findUserByEmail finds user', async () => {
      await auth.createUser({
        email: 'find@test.com',
        password: 'pass',
        first_name: 'F',
        last_name: 'I',
        role: 'admin',
        created_by: null,
      });

      const user = auth.findUserByEmail('find@test.com');
      expect(user).toBeDefined();
      expect(user!.email).toBe('find@test.com');
    });

    test('deleteUser removes user', async () => {
      const user = await auth.createUser({
        email: 'del@test.com',
        password: 'pass',
        first_name: 'D',
        last_name: 'E',
        role: 'staff',
        created_by: null,
      });

      expect(auth.deleteUser(user.id)).toBe(true);
      expect(auth.findUserById(user.id)).toBeUndefined();
    });
  });

  describe('Role Management', () => {
    test('updateUserRole changes role', async () => {
      const master = await auth.createUser({
        email: 'master@test.com',
        password: 'pass',
        first_name: 'M',
        last_name: 'A',
        role: 'master_admin',
        created_by: null,
      });

      const staff = await auth.createUser({
        email: 'staff@test.com',
        password: 'pass',
        first_name: 'S',
        last_name: 'T',
        role: 'staff',
        created_by: null,
      });

      const result = await auth.updateUserRole(staff.id, 'admin', master.id);
      expect(result.success).toBe(true);

      const updated = auth.findUserById(staff.id);
      expect(updated!.role).toBe('admin');
    });

    test('updateUserRole fails for non-master admin', async () => {
      const admin = await auth.createUser({
        email: 'adm@test.com',
        password: 'pass',
        first_name: 'A',
        last_name: 'D',
        role: 'admin',
        created_by: null,
      });

      const staff = await auth.createUser({
        email: 'stf@test.com',
        password: 'pass',
        first_name: 'S',
        last_name: 'F',
        role: 'staff',
        created_by: null,
      });

      const result = await auth.updateUserRole(staff.id, 'admin', admin.id);
      expect(result.success).toBe(false);
    });
  });

  describe('Master Admin Initialization', () => {
    test('initializeMasterAdmin from env vars', async () => {
      process.env.MASTER_ADMIN_EMAIL = 'init@test.com';
      process.env.MASTER_ADMIN_PASSWORD = 'initpass';

      const freshAuth = new AdminAuthService();
      await freshAuth.ready;

      const user = freshAuth.findUserByEmail('init@test.com');
      expect(user).toBeDefined();
      expect(user!.role).toBe('master_admin');

      delete process.env.MASTER_ADMIN_EMAIL;
      delete process.env.MASTER_ADMIN_PASSWORD;
    });
  });
});

describe('CustomerAuthService', () => {
  let auth: CustomerAuthService;

  beforeEach(() => {
    auth = new CustomerAuthService();
  });

  describe('Registration', () => {
    test('register creates a customer successfully', async () => {
      const result = await auth.register({
        email: 'customer@test.com',
        password: 'SecurePass!',
        first_name: 'John',
        last_name: 'Doe',
      });

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user!.email).toBe('customer@test.com');
      expect(result.user!.kyc_tier).toBe('tier_1');
      expect(result.user!.is_active).toBe(true);
    });

    test('register rejects duplicate email', async () => {
      await auth.register({
        email: 'dup@test.com',
        password: 'pass',
        first_name: 'A',
        last_name: 'B',
      });

      const result = await auth.register({
        email: 'dup@test.com',
        password: 'pass2',
        first_name: 'C',
        last_name: 'D',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Email already registered');
    });

    test('register with phone number', async () => {
      const result = await auth.register({
        email: 'phone@test.com',
        phone: '08012345678',
        password: 'pass',
        first_name: 'P',
        last_name: 'H',
      });
      expect(result.success).toBe(true);
      expect(result.user!.phone).toBe('08012345678');
    });

    test('register rejects duplicate phone', async () => {
      await auth.register({
        email: 'a@test.com',
        phone: '08011111111',
        password: 'pass',
        first_name: 'A',
        last_name: 'A',
      });

      const result = await auth.register({
        email: 'b@test.com',
        phone: '08011111111',
        password: 'pass',
        first_name: 'B',
        last_name: 'B',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Phone number already registered');
    });
  });

  describe('Login & Logout', () => {
    test('login succeeds with correct credentials', async () => {
      await auth.register({
        email: 'login@test.com',
        password: 'correct',
        first_name: 'L',
        last_name: 'I',
      });

      const result = await auth.login({ email: 'login@test.com', password: 'correct' });
      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
    });

    test('login fails with wrong password', async () => {
      await auth.register({
        email: 'wrong@test.com',
        password: 'correct',
        first_name: 'W',
        last_name: 'R',
      });

      const result = await auth.login({ email: 'wrong@test.com', password: 'wrong' });
      expect(result.success).toBe(false);
    });

    test('login fails for disabled account', async () => {
      const user = await auth.register({
        email: 'dis@test.com',
        password: 'pass',
        first_name: 'D',
        last_name: 'X',
      });
      // Manually disable (normally done by admin)
      auth.updateCustomer(user.user!.id, { is_active: false } as any);

      const result = await auth.login({ email: 'dis@test.com', password: 'pass' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Account is disabled');
    });

    test('logout invalidates token', async () => {
      await auth.register({
        email: 'lo@test.com',
        password: 'pass',
        first_name: 'L',
        last_name: 'O',
      });

      const loginResult = await auth.login({ email: 'lo@test.com', password: 'pass' });
      await auth.logout(loginResult.token!);
      expect(auth.validateToken(loginResult.token!)).toBeNull();
    });
  });

  describe('Token Validation', () => {
    test('validateToken returns user for valid token', async () => {
      await auth.register({
        email: 'tk@test.com',
        password: 'pass',
        first_name: 'T',
        last_name: 'K',
      });

      const loginResult = await auth.login({ email: 'tk@test.com', password: 'pass' });
      const user = auth.validateToken(loginResult.token!);
      expect(user).not.toBeNull();
      expect(user!.email).toBe('tk@test.com');
    });

    test('validateToken returns null for invalid token', () => {
      expect(auth.validateToken('nonexistent')).toBeNull();
    });
  });

  describe('Password Management', () => {
    test('changePassword works', async () => {
      const reg = await auth.register({
        email: 'cp@test.com',
        password: 'oldpass',
        first_name: 'C',
        last_name: 'P',
      });

      const result = await auth.changePassword(reg.user!.id, 'oldpass', 'newpass');
      expect(result.success).toBe(true);

      const login = await auth.login({ email: 'cp@test.com', password: 'newpass' });
      expect(login.success).toBe(true);
    });

    test('changePassword fails with wrong current password', async () => {
      const reg = await auth.register({
        email: 'cp2@test.com',
        password: 'correct',
        first_name: 'C',
        last_name: 'P',
      });

      const result = await auth.changePassword(reg.user!.id, 'wrong', 'newpass');
      expect(result.success).toBe(false);
    });
  });

  describe('Customer Management', () => {
    test('getCustomer returns sanitized user', async () => {
      const reg = await auth.register({
        email: 'get@test.com',
        password: 'pass',
        first_name: 'G',
        last_name: 'E',
      });

      const customer = auth.getCustomer(reg.user!.id);
      expect(customer).not.toBeNull();
      expect((customer as any).password_hash).toBeUndefined();
      expect((customer as any).salt).toBeUndefined();
    });

    test('getCustomer returns null for non-existent', () => {
      expect(auth.getCustomer('nonexistent')).toBeNull();
    });
  });
});
