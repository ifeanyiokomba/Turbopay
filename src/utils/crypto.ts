// TurboPay Cryptography Utilities (SDK)
// Encryption, hashing, and signature validation
//
// DUPLICATION NOTICE: turbopay-complete-latest/src/lib/turbopay/crypto.ts contains
// a parallel implementation for the Next.js app. Keep both files in sync when
// changing password hashing params, PII encryption, or token generation.
// The SDK version is the canonical source for provider webhook validation.

import crypto from 'crypto';

// =============================================================================
// ENCRYPTION UTILITIES
// =============================================================================

/**
 * AES-256-GCM Encryption for card data (Flutterwave style)
 */
export async function encryptAES256GCM(
  data: string,
  key: string,
  nonce: string
): Promise<string> {
  if (nonce.length !== 12) {
    throw new Error('Nonce must be exactly 12 characters long');
  }

  const decodedKeyBytes = Uint8Array.from(atob(key), c => c.charCodeAt(0));

  const cryptoSubtle = globalThis.crypto?.subtle || require('crypto').webcrypto?.subtle;
  if (!cryptoSubtle) {
    throw new Error('Crypto API is not available in this environment');
  }

  const keyObj = await cryptoSubtle.importKey(
    'raw',
    decodedKeyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = new TextEncoder().encode(nonce);

  const encryptedData = await cryptoSubtle.encrypt(
    { name: 'AES-GCM', iv },
    keyObj,
    new TextEncoder().encode(data)
  );

  return btoa(String.fromCharCode(...new Uint8Array(encryptedData)));
}

/**
 * Generate random nonce for encryption
 * Uses hex encoding to avoid entropy loss from base64 truncation
 */
export function generateNonce(length: number = 12): string {
  // Generate enough random bytes, then take hex chars (2 hex chars per byte)
  // For 12 chars we need 6 bytes minimum; generate extra for safety
  const bytesNeeded = Math.ceil(length / 2);
  return crypto.randomBytes(bytesNeeded).toString('hex').slice(0, length);
}

/**
 * MD5 Hash
 */
export function md5Hash(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * SHA256 Hash
 */
export function sha256Hash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Password hashing using scrypt (purpose-built for password storage).
 * Returns hex-encoded derived key with embedded salt.
 */
export function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString('hex'));
    });
  });
}

/**
 * Verify a password against a stored scrypt hash.
 */
export function verifyPassword(password: string, salt: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString('hex') === storedHash);
    });
  });
}

/**
 * SHA512 Hash
 */
export function sha512Hash(data: string): string {
  return crypto.createHash('sha512').update(data).digest('hex');
}

// =============================================================================
// HMAC UTILITIES
// =============================================================================

/**
 * HMAC-SHA256 Signature
 */
export function hmacSHA256(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * HMAC-SHA512 Signature
 */
export function hmacSHA512(data: string, secret: string): string {
  return crypto.createHmac('sha512', secret).update(data).digest('hex');
}

/**
 * HMAC-MD5 Signature
 * @deprecated MD5 is cryptographically broken. Use hmacSHA256 or hmacSHA512 instead.
 * Kept only for backward compatibility with legacy provider integrations.
 */
export function hmacMD5(data: string, secret: string): string {
  console.warn('[Crypto] hmacMD5 is deprecated — MD5 is cryptographically broken. Use hmacSHA256 or hmacSHA512.');
  return crypto.createHmac('md5', secret).update(data).digest('hex');
}

// =============================================================================
// SIGNATURE VALIDATION
// =============================================================================

/**
 * Validate Flutterwave webhook signature
 */
export function validateFlutterwaveSignature(
  payload: any,
  signature: string,
  secret: string
): boolean {
  const hash = hmacSHA256(JSON.stringify(payload), secret);
  return hash === signature;
}

/**
 * Validate Paystack webhook signature
 */
export function validatePaystackSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hash = sha512Hash(payload + secret);
  return hash === signature;
}

/**
 * Validate Monnify webhook signature
 */
export function validateMonnifySignature(
  payload: any,
  signature: string,
  secret: string
): boolean {
  const hash = hmacSHA256(JSON.stringify(payload), secret);
  return hash === signature;
}

/**
 * Validate Onafriq webhook signature
 */
export function validateOnafriqSignature(
  payload: any,
  signature: string,
  secret: string
): boolean {
  const hash = hmacSHA256(JSON.stringify(payload), secret);
  return hash === signature;
}

/**
 * Validate Remita webhook signature
 */
export function validateRemitaSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const computed = hmacSHA512(payload, secret);
  return computed === signature;
}

/**
 * Validate Quickteller webhook signature
 */
export function validateQuicktellerSignature(
  payload: any,
  signature: string,
  secret: string
): boolean {
  const hash = hmacSHA256(JSON.stringify(payload), secret);
  return hash === signature;
}

// =============================================================================
// REMITA SPECIFIC
// =============================================================================

/**
 * Generate Remita API hash
 * Format: apikey|merchantid|requestid|amount|apikey
 */
export function generateRemitaHash(
  apiKey: string,
  merchantId: string,
  requestId: string,
  amount: number
): string {
  const data = `${apiKey}|${merchantId}|${requestId}|${amount}|${apiKey}`;
  return sha512Hash(data);
}

/**
 * Generate Remita HMAC signature for webhooks
 */
export function generateRemitaHMAC(
  secretKey: string,
  data: string
): string {
  return hmacSHA512(data, secretKey);
}

// =============================================================================
// QUICKTELLER SPECIFIC
// =============================================================================

/**
 * Generate Quickteller auth signature
 */
export function generateQuicktellerAuthHash(
  clientId: string,
  clientSecret: string
): string {
  return sha512Hash(`${clientId}:${clientSecret}`);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate random reference
 */
export function generateReference(prefix: string = 'ref'): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Generate UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Mask account number
 */
export function maskAccountNumber(accountNumber: string, visibleDigits: number = 4): string {
  if (accountNumber.length <= visibleDigits) {
    return accountNumber;
  }
  const masked = '*'.repeat(accountNumber.length - visibleDigits);
  return masked + accountNumber.slice(-visibleDigits);
}

/**
 * Mask card number
 */
export function maskCardNumber(cardNumber: string): string {
  if (cardNumber.length < 10) {
    return cardNumber;
  }
  const first6 = cardNumber.slice(0, 6);
  const last4 = cardNumber.slice(-4);
  const masked = '*'.repeat(cardNumber.length - 10);
  return `${first6}${masked}${last4}`;
}

/**
 * Validate Nigerian BVN
 */
export function validateBVN(bvn: string): boolean {
  return /^\d{11}$/.test(bvn);
}

/**
 * Validate Nigerian NIN
 */
export function validateNIN(nin: string): boolean {
  return /^\d{11}$/.test(nin);
}

/**
 * Validate email
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number
 */
export function validatePhoneNumber(phone: string): boolean {
  const phoneRegex = /^\d{7,15}$/;
  return phoneRegex.test(phone);
}

/**
 * Format amount for display
 */
export function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2
  }).format(amount);
}

/**
 * Convert amount to minor units (kobo, cents, etc.)
 */
export function toMinorUnits(amount: number, currency: string): number {
  const decimalPlaces: Record<string, number> = {
    NGN: 2,
    GHS: 2,
    KES: 2,
    USD: 2,
    EUR: 2,
    GBP: 2,
    ZAR: 2,
    UGX: 0,
    TZS: 0,
    RWF: 0,
    ETB: 2,
    MWK: 2,
    EGP: 2,
    ZMW: 2
  };
  
  const decimals = decimalPlaces[currency] || 2;
  return Math.round(amount * Math.pow(10, decimals));
}

/**
 * Convert amount from minor units to major units
 */
export function fromMinorUnits(amount: number, currency: string): number {
  const decimalPlaces: Record<string, number> = {
    NGN: 2,
    GHS: 2,
    KES: 2,
    USD: 2,
    EUR: 2,
    GBP: 2,
    ZAR: 2,
    UGX: 0,
    TZS: 0,
    RWF: 0,
    ETB: 2,
    MWK: 2,
    EGP: 2,
    ZMW: 2
  };
  
  const decimals = decimalPlaces[currency] || 2;
  return amount / Math.pow(10, decimals);
}
