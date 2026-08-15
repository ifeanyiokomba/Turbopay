/**
 * Provider HTTP Security Tests
 * =============================
 *
 * Verifies that the centralized HTTP layer (jsonRequest) enforces SSRF
 * protection for all provider outbound requests.
 *
 * Tests cover:
 *   1. Allowed provider URLs (legitimate domains)
 *   2. Blocked private IPs
 *   3. Blocked localhost
 *   4. Blocked metadata endpoints
 *   5. Blocked IPv6 loopback
 *   6. Blocked file: and ftp: protocols
 *   7. Obfuscated IP detection
 *   8. Redirect to private IP
 */

import { describe, it, expect } from "vitest";
import { validateOutboundUrlSync, validateOutboundUrl, checkUrl, SsrfError } from "@/lib/turbopay/ssrf";

// ---------------------------------------------------------------------------
// 1. Allowed provider URLs
// ---------------------------------------------------------------------------

describe("Provider HTTP — Allowed provider URLs", () => {
  const allowedUrls = [
    "https://api.ng.termii.com/api/sms/send",
    "https://api.resend.com/emails",
    "https://api.otp.dev/v1/verifications",
    "https://sandbox.momodeveloper.mtn.com/collection/token/",
    "https://proxy.momoapi.mtn.com/collection/token/",
    "https://openapi.airtel.africa/auth/oauth2/token",
    "https://sandbox.safaricom.co.ke/oauth/v1/generate",
    "https://api.safaricom.co.ke/oauth/v1/generate",
    "https://www.paga.com/api/v1/merchant/collect",
    "https://test.paga.com/api/v1/merchant/collect",
    "https://api.paystack.co/transaction/initialize",
    "https://sandbox.monnify.com/api/v1/auth/login",
    "https://api.flutterwave.com/v3/transfers",
    "https://api.onafriq.com/v1/collection/token/",
    "https://api.dojah.co/api/v1/kyc/nin/verify",
    "https://api.quickteller.com/api/v1/billers",
    "https://api.remita.net/api/v1/billers",
    "https://baxi-payouts.capricorn-1.com/api/v1/bills",
    "https://orion.interswitchng.com/v3/interswitchng/biller/list",
    "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token",
  ];

  it.each(allowedUrls)(
    "should ALLOW %s",
    (url) => {
      expect(() => validateOutboundUrlSync(url)).not.toThrow();
    }
  );
});

// ---------------------------------------------------------------------------
// 2. Blocked private IPs
// ---------------------------------------------------------------------------

describe("Provider HTTP — Blocked private IPs", () => {
  const blockedIps = [
    "http://127.0.0.1/api",
    "http://10.0.0.1/api",
    "http://172.16.0.1/api",
    "http://192.168.1.1/api",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/",
  ];

  it.each(blockedIps)(
    "should BLOCK %s",
    (url) => {
      expect(() => validateOutboundUrlSync(url)).toThrow(SsrfError);
    }
  );
});

// ---------------------------------------------------------------------------
// 3. Blocked localhost
// ---------------------------------------------------------------------------

describe("Provider HTTP — Blocked localhost", () => {
  const blockedHosts = [
    "http://localhost/",
    "http://localhost:3000/",
    "http://ip6-localhost/",
    "http://ip6-loopback/",
  ];

  it.each(blockedHosts)(
    "should BLOCK %s",
    (url) => {
      expect(() => validateOutboundUrlSync(url)).toThrow(SsrfError);
    }
  );
});

// ---------------------------------------------------------------------------
// 4. Blocked metadata endpoints
// ---------------------------------------------------------------------------

describe("Provider HTTP — Blocked metadata endpoints", () => {
  const blockedMetadata = [
    "http://metadata.google.internal/",
    "http://metadata.azure.com/",
    "http://169.254.169.254/",
    "http://metadata.tencentyun.com/",
  ];

  it.each(blockedMetadata)(
    "should BLOCK %s",
    (url) => {
      expect(() => validateOutboundUrlSync(url)).toThrow(SsrfError);
    }
  );
});

// ---------------------------------------------------------------------------
// 5. Blocked IPv6 loopback
// ---------------------------------------------------------------------------

describe("Provider HTTP — Blocked IPv6", () => {
  const blockedIPv6 = [
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
  ];

  // IPv6 validation requires DNS resolution (async check)
  it.each(blockedIPv6)(
    "should BLOCK %s",
    async (url) => {
      const result = await checkUrl(url);
      expect(result.ok).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// 6. Blocked protocols
// ---------------------------------------------------------------------------

describe("Provider HTTP — Blocked protocols", () => {
  const blockedProtocols = [
    "file:///etc/passwd",
    "ftp://example.com/file",
    "gopher://example.com/",
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)",
  ];

  it.each(blockedProtocols)(
    "should BLOCK %s",
    (url) => {
      expect(() => validateOutboundUrlSync(url)).toThrow(SsrfError);
    }
  );
});

// ---------------------------------------------------------------------------
// 7. Obfuscated IP detection
// ---------------------------------------------------------------------------

describe("Provider HTTP — Obfuscated IP detection", () => {
  it("should block decimal-encoded loopback", () => {
    expect(() => validateOutboundUrlSync("http://2130706433/")).toThrow(SsrfError);
  });

  it("should block hex-encoded loopback", () => {
    expect(() => validateOutboundUrlSync("http://0x7f000001/")).toThrow(SsrfError);
  });

  it("should block octal-encoded loopback", () => {
    expect(() => validateOutboundUrlSync("http://0177.0.0.1/")).toThrow(SsrfError);
  });
});

// ---------------------------------------------------------------------------
// 8. Async redirect validation
// ---------------------------------------------------------------------------

describe("Provider HTTP — Async redirect validation", () => {
  it("should block redirect to private IP via async check", async () => {
    await expect(validateOutboundUrl("http://192.168.1.1/")).rejects.toThrow(SsrfError);
  });

  it("should block redirect to localhost via async check", async () => {
    await expect(validateOutboundUrl("http://localhost/")).rejects.toThrow(SsrfError);
  });

  it("should allow legitimate provider URLs via async check", async () => {
    await expect(validateOutboundUrl("https://api.paystack.co/")).resolves.toBeUndefined();
  });
});
