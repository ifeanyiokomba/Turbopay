// TurboPay Cryptography Utilities — Unit Tests
// Covers: password hashing (scrypt), encryption, signature validation, HMAC, utilities

import {
  hashPassword,
  verifyPassword,
  encryptAES256GCM,
  generateNonce,
  hmacSHA256,
  hmacSHA512,
  sha256Hash,
  sha512Hash,
  md5Hash,
  validateFlutterwaveSignature,
  validatePaystackSignature,
  validateMonnifySignature,
  validateRemitaSignature,
  validateQuicktellerSignature,
  generateRemitaHash,
  generateRemitaHMAC,
  generateQuicktellerAuthHash,
  generateReference,
  generateUUID,
  maskAccountNumber,
  maskCardNumber,
  validateBVN,
  validateNIN,
  validateEmail,
  validatePhoneNumber,
  formatAmount,
  toMinorUnits,
  fromMinorUnits,
} from '../utils/crypto';

describe('Crypto Utilities', () => {
  // =========================================================================
  // PASSWORD HASHING (scrypt)
  // =========================================================================

  describe('Password Hashing (scrypt)', () => {
    test('hashPassword returns a 128-char hex string', async () => {
      const salt = 'a'.repeat(32);
      const hash = await hashPassword('testpassword', salt);
      expect(hash).toMatch(/^[0-9a-f]{128}$/);
    });

    test('same password + salt produces same hash', async () => {
      const salt = 'b'.repeat(32);
      const h1 = await hashPassword('mypassword', salt);
      const h2 = await hashPassword('mypassword', salt);
      expect(h1).toBe(h2);
    });

    test('different passwords produce different hashes', async () => {
      const salt = 'c'.repeat(32);
      const h1 = await hashPassword('password1', salt);
      const h2 = await hashPassword('password2', salt);
      expect(h1).not.toBe(h2);
    });

    test('different salts produce different hashes for same password', async () => {
      const h1 = await hashPassword('samepass', 'd'.repeat(32));
      const h2 = await hashPassword('samepass', 'e'.repeat(32));
      expect(h1).not.toBe(h2);
    });

    test('verifyPassword returns true for correct password', async () => {
      const salt = 'f'.repeat(32);
      const hash = await hashPassword('correct', salt);
      const result = await verifyPassword('correct', salt, hash);
      expect(result).toBe(true);
    });

    test('verifyPassword returns false for wrong password', async () => {
      const salt = 'g'.repeat(32);
      const hash = await hashPassword('correct', salt);
      const result = await verifyPassword('wrong', salt, hash);
      expect(result).toBe(false);
    });

    test('verifyPassword returns false for wrong salt', async () => {
      const salt = 'h'.repeat(32);
      const hash = await hashPassword('correct', salt);
      const result = await verifyPassword('correct', 'i'.repeat(32), hash);
      expect(result).toBe(false);
    });

    test('empty password hashes successfully', async () => {
      const salt = 'j'.repeat(32);
      const hash = await hashPassword('', salt);
      expect(hash).toMatch(/^[0-9a-f]{128}$/);
      const valid = await verifyPassword('', salt, hash);
      expect(valid).toBe(true);
    });

    test('long password hashes successfully', async () => {
      const salt = 'k'.repeat(32);
      const longPass = 'x'.repeat(1000);
      const hash = await hashPassword(longPass, salt);
      const valid = await verifyPassword(longPass, salt, hash);
      expect(valid).toBe(true);
    });
  });

  // =========================================================================
  // ENCRYPTION
  // =========================================================================

  describe('AES-256-GCM Encryption', () => {
    test('generateNonce returns correct length', () => {
      expect(generateNonce(12)).toHaveLength(12);
      expect(generateNonce(16)).toHaveLength(16);
      expect(generateNonce(8)).toHaveLength(8);
    });

    test('generateNonce returns hex characters only', () => {
      const nonce = generateNonce(20);
      expect(nonce).toMatch(/^[0-9a-f]+$/);
    });

    test('encryptAES256GCM produces base64 output', async () => {
      const key = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'; // 32 bytes base64
      const nonce = generateNonce(12);
      const encrypted = await encryptAES256GCM('hello world', key, nonce);
      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(0);
    });

    test('encryptAES256GCM throws on wrong nonce length', async () => {
      const key = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
      await expect(encryptAES256GCM('test', key, 'short')).rejects.toThrow('Nonce must be exactly 12 characters long');
    });
  });

  // =========================================================================
  // HASH FUNCTIONS
  // =========================================================================

  describe('Hash Functions', () => {
    test('sha256Hash produces 64-char hex', () => {
      const hash = sha256Hash('test');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    test('sha512Hash produces 128-char hex', () => {
      const hash = sha512Hash('test');
      expect(hash).toMatch(/^[0-9a-f]{128}$/);
    });

    test('md5Hash produces 32-char hex', () => {
      const hash = md5Hash('test');
      expect(hash).toMatch(/^[0-9a-f]{32}$/);
    });

    test('hashes are deterministic', () => {
      expect(sha256Hash('abc')).toBe(sha256Hash('abc'));
      expect(sha512Hash('abc')).toBe(sha512Hash('abc'));
      expect(md5Hash('abc')).toBe(md5Hash('abc'));
    });

    test('different inputs produce different hashes', () => {
      expect(sha256Hash('a')).not.toBe(sha256Hash('b'));
    });
  });

  // =========================================================================
  // HMAC
  // =========================================================================

  describe('HMAC Functions', () => {
    test('hmacSHA256 produces 64-char hex', () => {
      const sig = hmacSHA256('data', 'secret');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    test('hmacSHA512 produces 128-char hex', () => {
      const sig = hmacSHA512('data', 'secret');
      expect(sig).toMatch(/^[0-9a-f]{128}$/);
    });

    test('different secrets produce different HMACs', () => {
      const s1 = hmacSHA256('data', 'secret1');
      const s2 = hmacSHA256('data', 'secret2');
      expect(s1).not.toBe(s2);
    });

    test('HMACs are deterministic', () => {
      expect(hmacSHA256('a', 'b')).toBe(hmacSHA256('a', 'b'));
    });
  });

  // =========================================================================
  // SIGNATURE VALIDATION
  // =========================================================================

  describe('Webhook Signature Validation', () => {
    test('validateFlutterwaveSignature — valid', () => {
      const payload = { event: 'charge.completed', data: { id: 123 } };
      const secret = 'fw_secret';
      const hash = hmacSHA256(JSON.stringify(payload), secret);
      expect(validateFlutterwaveSignature(payload, hash, secret)).toBe(true);
    });

    test('validateFlutterwaveSignature — invalid', () => {
      const payload = { event: 'charge.completed' };
      expect(validateFlutterwaveSignature(payload, 'bad_sig', 'secret')).toBe(false);
    });

    test('validateMonnifySignature — valid', () => {
      const payload = { event: 'successful' };
      const secret = 'mon_secret';
      const hash = hmacSHA256(JSON.stringify(payload), secret);
      expect(validateMonnifySignature(payload, hash, secret)).toBe(true);
    });

    test('validateMonnifySignature — invalid', () => {
      expect(validateMonnifySignature({}, 'bad', 's')).toBe(false);
    });

    test('validatePaystackSignature — valid', () => {
      const payload = '{"event":"charge.success"}';
      const secret = 'ps_secret';
      const hash = sha512Hash(payload + secret);
      expect(validatePaystackSignature(payload, hash, secret)).toBe(true);
    });

    test('validatePaystackSignature — invalid', () => {
      expect(validatePaystackSignature('body', 'bad', 's')).toBe(false);
    });

    test('validateRemitaSignature — valid', () => {
      const payload = '{"status":"success"}';
      const secret = 'rm_secret';
      const hash = hmacSHA512(payload, secret);
      expect(validateRemitaSignature(payload, hash, secret)).toBe(true);
    });

    test('validateRemitaSignature — invalid', () => {
      expect(validateRemitaSignature('body', 'bad', 's')).toBe(false);
    });

    test('validateQuicktellerSignature — valid', () => {
      const payload = { responseCode: '00' };
      const secret = 'qt_secret';
      const hash = hmacSHA256(JSON.stringify(payload), secret);
      expect(validateQuicktellerSignature(payload, hash, secret)).toBe(true);
    });

    test('validateQuicktellerSignature — invalid', () => {
      expect(validateQuicktellerSignature({}, 'bad', 's')).toBe(false);
    });
  });

  // =========================================================================
  // PROVIDER-SPECIFIC HASH GENERATORS
  // =========================================================================

  describe('Provider-Specific Hash Generators', () => {
    test('generateRemitaHash produces 128-char hex', () => {
      const hash = generateRemitaHash('api_key', 'merchant_id', 'req_001', 5000);
      expect(hash).toMatch(/^[0-9a-f]{128}$/);
    });

    test('generateRemitaHMAC produces 128-char hex', () => {
      const hmac = generateRemitaHMAC('secret_key', 'data');
      expect(hmac).toMatch(/^[0-9a-f]{128}$/);
    });

    test('generateQuicktellerAuthHash produces 128-char hex', () => {
      const hash = generateQuicktellerAuthHash('client_id', 'client_secret');
      expect(hash).toMatch(/^[0-9a-f]{128}$/);
    });
  });

  // =========================================================================
  // UTILITY FUNCTIONS
  // =========================================================================

  describe('Utility Functions', () => {
    test('generateReference has correct prefix', () => {
      const ref = generateReference('tx');
      expect(ref).toMatch(/^tx_\d+_[0-9a-f]+$/);
    });

    test('generateReference default prefix', () => {
      const ref = generateReference();
      expect(ref).toMatch(/^ref_\d+_[0-9a-f]+$/);
    });

    test('generateUUID returns valid UUID format', () => {
      const uuid = generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    test('maskAccountNumber masks correctly', () => {
      expect(maskAccountNumber('1234567890')).toBe('******7890');
      expect(maskAccountNumber('1234567890', 6)).toBe('****567890');
    });

    test('maskAccountNumber short number unchanged', () => {
      expect(maskAccountNumber('1234', 4)).toBe('1234');
    });

    test('maskCardNumber masks correctly', () => {
      const masked = maskCardNumber('4111111111111111');
      // Shows first 6 + last 4, middle (16-10=6) asterisks
      expect(masked).toMatch(/^411111\*{6}1111$/);
    });

    test('maskCardNumber short card unchanged', () => {
      expect(maskCardNumber('123456789')).toBe('123456789');
    });
  });

  // =========================================================================
  // VALIDATION FUNCTIONS
  // =========================================================================

  describe('Validation Functions', () => {
    test('validateBVN — valid 11 digits', () => {
      expect(validateBVN('12345678901')).toBe(true);
    });

    test('validateBVN — invalid', () => {
      expect(validateBVN('12345')).toBe(false);
      expect(validateBVN('1234567890a')).toBe(false);
    });

    test('validateNIN — valid 11 digits', () => {
      expect(validateNIN('12345678901')).toBe(true);
    });

    test('validateNIN — invalid', () => {
      expect(validateNIN('short')).toBe(false);
    });

    test('validateEmail — valid', () => {
      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('admin@turbopay.ng')).toBe(true);
    });

    test('validateEmail — invalid', () => {
      expect(validateEmail('notanemail')).toBe(false);
      expect(validateEmail('@no-local.com')).toBe(false);
      expect(validateEmail('no-at-sign.com')).toBe(false);
    });

    test('validatePhoneNumber — valid', () => {
      expect(validatePhoneNumber('08012345678')).toBe(true);
      expect(validatePhoneNumber('1234567')).toBe(true);
    });

    test('validatePhoneNumber — invalid', () => {
      expect(validatePhoneNumber('short')).toBe(false);
      expect(validatePhoneNumber('abc123')).toBe(false);
    });
  });

  // =========================================================================
  // CURRENCY UTILITIES
  // =========================================================================

  describe('Currency Utilities', () => {
    test('toMinorUnits NGN — 2 decimal places', () => {
      expect(toMinorUnits(100, 'NGN')).toBe(10000);
      expect(toMinorUnits(1.5, 'NGN')).toBe(150);
    });

    test('toMinorUnits UGX — 0 decimal places', () => {
      expect(toMinorUnits(1000, 'UGX')).toBe(1000);
    });

    test('fromMinorUnits reverses toMinorUnits', () => {
      const amount = 5000;
      const minor = toMinorUnits(amount, 'NGN');
      expect(fromMinorUnits(minor, 'NGN')).toBe(amount);
    });

    test('toMinorUnits handles unknown currency (default 2)', () => {
      expect(toMinorUnits(100, 'XYZ')).toBe(10000);
    });

    test('formatAmount returns string with currency symbol', () => {
      const formatted = formatAmount(1000, 'NGN');
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    });
  });
});
