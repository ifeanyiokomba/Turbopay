/**
 * SSRF Protection Tests
 * ======================
 *
 * Comprehensive test suite proving the SSRF guard actually works.
 * Tests cover:
 *   1. Blocked IPv4 ranges (loopback, private, link-local, multicast, reserved)
 *   2. Blocked IPv6 ranges (loopback, ULA, link-local, multicast)
 *   3. Blocked hostnames (localhost, cloud metadata endpoints)
 *   4. Obfuscated IP detection (decimal, octal, hex)
 *   5. Allowed targets (legitimate external URLs)
 *   6. Redirect chain validation
 *   7. URL validation edge cases
 *   8. fetchSafe wrapper behavior
 *
 * Uses deterministic checks — no external service dependencies.
 * For IP-range checks, tests use validateOutboundUrlSync (synchronous, no DNS)
 * to prove the CIDR matching logic works, plus checkUrl for the async path.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkUrl,
  validateOutboundUrl,
  validateOutboundUrlSync,
  isPrivateUrl,
  fetchSafe,
  SsrfError,
  hashOutboundUrl,
} from "../ssrf";

// ---------------------------------------------------------------------------
// 1. Blocked IPv4 ranges (using sync check — no DNS dependency)
// ---------------------------------------------------------------------------

describe("SSRF — Blocked IPv4 targets", () => {
  const blockedCases: [string, string][] = [
    ["http://0.0.0.0/", "IPv4 this-network"],
    ["http://0.0.0.1/", "IPv4 this-network"],
    ["http://127.0.0.1/", "IPv4 loopback"],
    ["http://127.0.0.2/", "IPv4 loopback"],
    ["http://127.255.255.255/", "IPv4 loopback"],
    ["http://10.0.0.1/", "RFC1918 10/8"],
    ["http://10.255.255.255/", "RFC1918 10/8"],
    ["http://100.64.0.1/", "CGNAT"],
    ["http://100.127.255.255/", "CGNAT"],
    ["http://172.16.0.1/", "RFC1918 172.16/12"],
    ["http://172.31.255.255/", "RFC1918 172.16/12"],
    ["http://192.168.0.1/", "RFC1918 192.168/16"],
    ["http://192.168.255.255/", "RFC1918 192.168/16"],
    ["http://169.254.1.1/", "link-local"],
    ["http://169.254.169.254/", "cloud metadata"],
    ["http://224.0.0.1/", "multicast"],
    ["http://240.0.0.1/", "reserved class E"],
    ["http://192.0.0.1/", "IETF protocol"],
    ["http://192.0.2.1/", "TEST-NET-1"],
    ["http://198.51.100.1/", "TEST-NET-2"],
    ["http://198.18.0.1/", "benchmark"],
  ];

  it.each(blockedCases)(
    "should BLOCK %s (%s)",
    async (url, _label) => {
      // Use sync check to prove CIDR matching logic works (no DNS dependency)
      expect(() => validateOutboundUrlSync(url)).toThrow(SsrfError);
    }
  );
});

// ---------------------------------------------------------------------------
// 2. Blocked IPv6 targets
// ---------------------------------------------------------------------------

describe("SSRF — Blocked IPv6 targets", () => {
  const blockedIPv6: [string, string][] = [
    ["http://[::1]/", "IPv6 loopback"],
    ["http://[::]/", "IPv6 unspecified"],
    ["http://[fc00::1]/", "IPv6 ULA"],
    ["http://[fd00::1]/", "IPv6 ULA"],
    ["http://[fe80::1]/", "IPv6 link-local"],
    ["http://[ff02::1]/", "IPv6 multicast"],
    ["http://[::ffff:127.0.0.1]/", "IPv4-mapped loopback"],
    ["http://[::ffff:10.0.0.1]/", "IPv4-mapped RFC1918"],
    ["http://[::ffff:192.168.1.1]/", "IPv4-mapped RFC1918"],
  ];

  it.each(blockedIPv6)(
    "should BLOCK %s (%s)",
    async (url, _label) => {
      const result = await checkUrl(url);
      expect(result.ok).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// 3. Blocked hostnames
// ---------------------------------------------------------------------------

describe("SSRF — Blocked hostnames", () => {
  const blockedHostnames: [string, string][] = [
    ["http://localhost/", "localhost"],
    ["http://localhost:3000/", "localhost with port"],
    ["http://ip6-localhost/", "ip6-localhost"],
    ["http://ip6-loopback/", "ip6-loopback"],
    ["http://metadata.google.internal/", "GCP metadata"],
    ["http://metadata.azure.com/", "Azure metadata"],
    ["http://169.254.169.254/", "AWS/GCP metadata IP"],
    ["http://metadata.tencentyun.com/", "Tencent metadata"],
    ["http://sub.localhost/", "localhost subdomain"],
    ["http://foo.metadata.google.internal/", "GCP metadata subdomain"],
    ["http://169.254.169.254:8080/", "metadata IP with port"],
  ];

  it.each(blockedHostnames)(
    "should BLOCK %s (%s)",
    async (url, _label) => {
      const result = await checkUrl(url);
      expect(result.ok).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// 4. Obfuscated IP detection
// ---------------------------------------------------------------------------

describe("SSRF — Obfuscated IP detection", () => {
  it("should block decimal-encoded loopback (2130706433 = 127.0.0.1)", () => {
    expect(() => validateOutboundUrlSync("http://2130706433/")).toThrow(SsrfError);
  });

  it("should block hex-encoded loopback (0x7f000001 = 127.0.0.1)", () => {
    expect(() => validateOutboundUrlSync("http://0x7f000001/")).toThrow(SsrfError);
  });

  it("should block hex octets (0x7f.0.0.1 = 127.0.0.1)", () => {
    expect(() => validateOutboundUrlSync("http://0x7f.0.0.1/")).toThrow(SsrfError);
  });

  it("should block octal-encoded loopback (0177.0.0.1 = 127.0.0.1)", () => {
    expect(() => validateOutboundUrlSync("http://0177.0.0.1/")).toThrow(SsrfError);
  });

  it("should block decimal-encoded private (167772161 = 10.0.0.1)", () => {
    expect(() => validateOutboundUrlSync("http://167772161/")).toThrow(SsrfError);
  });

  it("should allow decimal-encoded public IP (8.8.8.8 = 134744072)", () => {
    expect(() => validateOutboundUrlSync("http://134744072/")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Allowed targets (legitimate external URLs)
// ---------------------------------------------------------------------------

describe("SSRF — Allowed external targets", () => {
  const allowedTargets: [string][] = [
    ["https://api.paystack.co/transaction/initialize"],
    ["https://api.flutterwave.com/v3/transfers"],
    ["https://api.monnify.com/api/v1/bank-transfer/reserved-account"],
    ["https://api.termii.com/api/sms/send"],
    ["https://api.resend.com/emails"],
    ["https://api.ng.termii.com/api/sms/send"],
    ["https://api.otp.dev/v1/verifications"],
    ["https://www.google.com"],
    ["https://example.com/path?q=test"],
    ["https://1.1.1.1/"],  // Cloudflare DNS — public IP
    ["http://8.8.8.8/"],   // Google DNS — public IP
  ];

  it.each(allowedTargets)(
    "should ALLOW %s",
    async (url) => {
      const result = await checkUrl(url);
      expect(result.ok).toBe(true);
    }
  );
});

// ---------------------------------------------------------------------------
// 6. URL validation edge cases
// ---------------------------------------------------------------------------

describe("SSRF — URL validation edge cases", () => {
  it("should reject invalid URLs", () => {
    const result = checkUrl("not-a-url");
    // checkUrl is async, but the invalid URL check happens synchronously
    // We can test with the sync validator
    expect(() => validateOutboundUrlSync("not-a-url")).toThrow(SsrfError);
  });

  it("should reject ftp: scheme", async () => {
    const result = await checkUrl("ftp://example.com/file");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Disallowed scheme");
  });

  it("should reject file: scheme", async () => {
    const result = await checkUrl("file:///etc/passwd");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Disallowed scheme");
  });

  it("should reject data: scheme", async () => {
    const result = await checkUrl("data:text/html,<script>alert(1)</script>");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Disallowed scheme");
  });

  it("should reject javascript: scheme", async () => {
    const result = await checkUrl("javascript:alert(1)");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Disallowed scheme");
  });

  it("should reject ftp with IP", () => {
    expect(() => validateOutboundUrlSync("ftp://192.168.1.1/file")).toThrow(SsrfError);
  });
});

// ---------------------------------------------------------------------------
// 7. validateOutboundUrlSync (synchronous variant)
// ---------------------------------------------------------------------------

describe("SSRF — validateOutboundUrlSync", () => {
  it("should throw SsrfError for localhost", () => {
    expect(() => validateOutboundUrlSync("http://localhost/")).toThrow(SsrfError);
  });

  it("should throw SsrfError for 127.0.0.1", () => {
    expect(() => validateOutboundUrlSync("http://127.0.0.1/")).toThrow(SsrfError);
  });

  it("should throw SsrfError for 192.168.1.1", () => {
    expect(() => validateOutboundUrlSync("http://192.168.1.1/")).toThrow(SsrfError);
  });

  it("should throw SsrfError for 10.0.0.1", () => {
    expect(() => validateOutboundUrlSync("http://10.0.0.1/")).toThrow(SsrfError);
  });

  it("should throw SsrfError for invalid URL", () => {
    expect(() => validateOutboundUrlSync("not-a-url")).toThrow(SsrfError);
  });

  it("should throw SsrfError for ftp scheme", () => {
    expect(() => validateOutboundUrlSync("ftp://example.com")).toThrow(SsrfError);
  });

  it("should NOT throw for valid external URL", () => {
    expect(() => validateOutboundUrlSync("https://api.paystack.co/test")).not.toThrow();
  });

  it("should NOT throw for 1.1.1.1 (Cloudflare public)", () => {
    expect(() => validateOutboundUrlSync("http://1.1.1.1/")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. isPrivateUrl helper
// ---------------------------------------------------------------------------

describe("SSRF — isPrivateUrl", () => {
  it("should return true for private IPs (sync check)", async () => {
    // These use the sync path via checkUrl which catches literal IPs
    expect(await isPrivateUrl("http://127.0.0.1/")).toBe(true);
    expect(await isPrivateUrl("http://10.0.0.1/")).toBe(true);
  });

  it("should return false for public URLs", async () => {
    expect(await isPrivateUrl("https://api.paystack.co/")).toBe(false);
    expect(await isPrivateUrl("https://example.com/")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. hashOutboundUrl
// ---------------------------------------------------------------------------

describe("SSRF — hashOutboundUrl", () => {
  it("should return a 16-char hex hash", () => {
    const hash = hashOutboundUrl("https://api.paystack.co/transaction/initialize");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should be deterministic", () => {
    const url = "https://example.com/test?secret=abc123";
    const h1 = hashOutboundUrl(url);
    const h2 = hashOutboundUrl(url);
    expect(h1).toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// 10. Redirect chain behavior (fetchSafe)
// ---------------------------------------------------------------------------

describe("SSRF — fetchSafe redirect protection", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should follow redirects to allowed targets", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response("", {
        status: 302,
        headers: { location: "https://api.paystack.co/final" },
      }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await fetchSafe("https://example.com/redirect");
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("should BLOCK redirect to localhost", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response("", {
        status: 302,
        headers: { location: "http://localhost:3000/admin" },
      }));

    await expect(
      fetchSafe("https://example.com/redirect")
    ).rejects.toThrow(SsrfError);
  });

  it("should BLOCK redirect to metadata endpoint", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response("", {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }));

    await expect(
      fetchSafe("https://example.com/redirect")
    ).rejects.toThrow(SsrfError);
  });

  it("should throw SsrfError for initial blocked URL", async () => {
    await expect(
      fetchSafe("http://127.0.0.1/admin")
    ).rejects.toThrow(SsrfError);
  });

  it("should respect MAX_HOPS limit", async () => {
    globalThis.fetch = vi.fn();
    for (let i = 0; i < 6; i++) {
      (globalThis.fetch as any).mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { location: `https://example.com/redirect/${i + 1}` },
        })
      );
    }

    await expect(
      fetchSafe("https://example.com/redirect/0")
    ).rejects.toThrow("Redirect chain exceeded");
  });

  it("should not pass Authorization header on cross-origin redirect", async () => {
    let secondCallInit: RequestInit | undefined;

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { location: "https://other-site.com/callback" },
        })
      )
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        secondCallInit = init;
        return new Response("ok", { status: 200 });
      });

    await fetchSafe("https://example.com/redirect", {
      headers: { Authorization: "Bearer secret-token" },
    });

    // The second fetch (cross-origin) should NOT have Authorization
    expect(secondCallInit?.headers).toBeDefined();
    const headers = secondCallInit?.headers as Headers;
    expect(headers.get("authorization")).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 11. validateOutboundUrl throws
// ---------------------------------------------------------------------------

describe("SSRF — validateOutboundUrl (throwing variant)", () => {
  it("should throw SsrfError for blocked URLs", async () => {
    await expect(validateOutboundUrl("http://127.0.0.1/")).rejects.toThrow(SsrfError);
    await expect(validateOutboundUrl("http://localhost/")).rejects.toThrow(SsrfError);
    await expect(validateOutboundUrl("http://10.0.0.1/")).rejects.toThrow(SsrfError);
  });

  it("should NOT throw for allowed URLs", async () => {
    await expect(validateOutboundUrl("https://api.paystack.co/")).resolves.toBeUndefined();
    await expect(validateOutboundUrl("https://example.com/")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 12. Blocking rationale — prove each CIDR range is actually covered
// ---------------------------------------------------------------------------

describe("SSRF — CIDR range coverage", () => {
  const cidrTests: [string, string][] = [
    // IPv4 ranges
    ["http://0.0.0.0/", "0.0.0.0/8"],
    ["http://0.255.255.255/", "0.0.0.0/8"],
    ["http://10.0.0.1/", "10.0.0.0/8"],
    ["http://10.255.255.255/", "10.0.0.0/8"],
    ["http://100.64.0.1/", "100.64.0.0/10"],
    ["http://100.127.255.255/", "100.64.0.0/10"],
    ["http://127.0.0.1/", "127.0.0.0/8"],
    ["http://127.255.255.255/", "127.0.0.0/8"],
    ["http://169.254.0.1/", "169.254.0.0/16"],
    ["http://172.16.0.1/", "172.16.0.0/12"],
    ["http://172.31.255.255/", "172.16.0.0/12"],
    ["http://192.168.0.1/", "192.168.0.0/16"],
    ["http://192.168.255.255/", "192.168.0.0/16"],
    ["http://224.0.0.1/", "224.0.0.0/4"],
    ["http://255.255.255.255/", "240.0.0.0/4"],
  ];

  it.each(cidrTests)(
    "should BLOCK %s (%s) via sync validation",
    (url, _range) => {
      expect(() => validateOutboundUrlSync(url)).toThrow(SsrfError);
    }
  );
});
