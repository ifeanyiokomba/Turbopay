/**
 * SSRF Prevention — URL Validation + DNS Rebinding Protection
 * ===========================================================
 *
 * Blocks outbound requests to internal/private IP ranges to prevent
 * Server-Side Request Forgery. Used as a guard before any fetch() call
 * that accepts user-influenced URLs.
 *
 * Security features (adapted from Turbo reference architecture):
 *   - 16 blocked IPv4/IPv6 CIDR ranges (loopback, private, link-local,
 *     CGNAT, multicast, reserved, IPv6 loopback / ULA / link-local)
 *   - 7 blocked hostnames (localhost variants + cloud metadata endpoints)
 *   - Obfuscation detection: decimal (16843009), octal (0177), hex (0x7f)
 *     encoded IPs that resolve to private ranges
 *   - Redirect-chain validation: `fetchSafe` follows redirects but
 *     re-validates each hop, caps at 5 redirects, strips cookies on
 *     cross-origin redirects
 *   - DNS rebinding protection: resolves ALL DNS records and validates each
 *
 * Reference: OWASP SSRF Prevention Cheat Sheet
 */

import * as dns from "node:dns";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Blocked CIDR ranges (16 patterns)
// ---------------------------------------------------------------------------

const BLOCKED_RANGES: readonly {
  family: 4 | 6;
  cidr: string;
  label: string;
}[] = [
  // IPv4 (13 ranges)
  { family: 4, cidr: "0.0.0.0/8", label: "IPv4 'this network'" },
  { family: 4, cidr: "10.0.0.0/8", label: "RFC1918 private (10/8)" },
  { family: 4, cidr: "100.64.0.0/10", label: "CGNAT (RFC6598)" },
  { family: 4, cidr: "127.0.0.0/8", label: "IPv4 loopback" },
  { family: 4, cidr: "169.254.0.0/16", label: "IPv4 link-local" },
  { family: 4, cidr: "172.16.0.0/12", label: "RFC1918 private (172.16/12)" },
  { family: 4, cidr: "192.0.0.0/24", label: "IETF protocol assignments" },
  { family: 4, cidr: "192.0.2.0/24", label: "TEST-NET-1 (documentation)" },
  { family: 4, cidr: "192.168.0.0/16", label: "RFC1918 private (192.168/16)" },
  { family: 4, cidr: "198.18.0.0/15", label: "Benchmark testing (RFC2544)" },
  { family: 4, cidr: "198.51.100.0/24", label: "TEST-NET-2 (documentation)" },
  { family: 4, cidr: "224.0.0.0/4", label: "IPv4 multicast" },
  { family: 4, cidr: "240.0.0.0/4", label: "IPv4 reserved (class E)" },
  // IPv6 (3 ranges)
  { family: 6, cidr: "::1/128", label: "IPv6 loopback" },
  { family: 6, cidr: "fc00::/7", label: "IPv6 unique local (ULA)" },
  { family: 6, cidr: "fe80::/10", label: "IPv6 link-local" },
];

// ---------------------------------------------------------------------------
// Blocked hostnames (7 patterns)
// ---------------------------------------------------------------------------

const BLOCKED_HOSTNAMES: readonly string[] = [
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal", // GCP metadata endpoint
  "metadata.azure.com", // Azure metadata (IMDS uses 169.254.169.254 directly)
  "169.254.169.254", // AWS / Azure / GCP metadata IP
  "metadata.tencentyun.com", // Tencent Cloud metadata
];

// ---------------------------------------------------------------------------
// IP utilities
// ---------------------------------------------------------------------------

/** Parse an IPv4 dotted-quad into a 32-bit unsigned integer. */
function parseIpv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    // Reject leading zeros (e.g. "0177") — they're octal obfuscation.
    if (part.length > 1 && part.startsWith("0")) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

/** Parse an IPv4 CIDR into { ip, mask } with both as unsigned 32-bit ints. */
function parseIpv4Cidr(cidr: string): { ip: number; mask: number } | null {
  const [ipStr, prefixStr] = cidr.split("/");
  if (!ipStr || !prefixStr) return null;
  const ip = parseIpv4(ipStr);
  if (ip == null) return null;
  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { ip: (ip & mask) >>> 0, mask };
}

/** Check if an IPv4 address (as a 32-bit uint) falls in any blocked range. */
function isIpv4Blocked(ip: number): string | null {
  for (const range of BLOCKED_RANGES) {
    if (range.family !== 4) continue;
    const parsed = parseIpv4Cidr(range.cidr);
    if (!parsed) continue;
    if ((ip & parsed.mask) >>> 0 === parsed.ip) {
      return range.label;
    }
  }
  return null;
}

/** Check an IPv6 address against the well-known blocked ranges. */
function isIpv6Blocked(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (lower === "::1") return "IPv6 loopback";
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "IPv6 unique local (ULA)";
  if (/^fe[89a-f]/i.test(lower)) return "IPv6 link-local";
  if (lower === "::") return "IPv6 unspecified";
  if (lower.startsWith("ff")) return "IPv6 multicast";
  // IPv4-mapped (::ffff:a.b.c.d)
  const v4Mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (v4Mapped) {
    const ipInt = parseIpv4(v4Mapped[1]);
    if (ipInt != null) {
      const label = isIpv4Blocked(ipInt);
      if (label) return `IPv4-mapped → ${label}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Obfuscation detection
// ---------------------------------------------------------------------------

/**
 * Detect obfuscated IPv4 addresses.
 *   - Decimal:  16843009        → 1.1.1.1
 *   - Octal:    0177.0.0.1      → 127.0.0.1
 *   - Hex:      0x7f.0.0.1      → 127.0.0.1
 *                0x7f000001     → 127.0.0.1
 * Returns the dotted-quad form if an obfuscation was detected, else null.
 */
function detectObfuscation(hostname: string): string | null {
  // Pure-integer form (decimal / hex)
  if (/^\d+$/.test(hostname)) {
    const n = Number(hostname);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) {
      const a = (n >>> 24) & 0xff;
      const b = (n >>> 16) & 0xff;
      const c = (n >>> 8) & 0xff;
      const d = n & 0xff;
      return `${a}.${b}.${c}.${d}`;
    }
  }
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    const n = parseInt(hostname, 16);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) {
      const a = (n >>> 24) & 0xff;
      const b = (n >>> 16) & 0xff;
      const c = (n >>> 8) & 0xff;
      const d = n & 0xff;
      return `${a}.${b}.${c}.${d}`;
    }
  }
  // Dotted form with octal/hex octets
  if (hostname.includes(".")) {
    const parts = hostname.split(".");
    if (parts.length === 4) {
      const octets: number[] = [];
      let obfuscated = false;
      for (const part of parts) {
        if (/^0[0-7]+$/.test(part)) {
          octets.push(parseInt(part, 8));
          obfuscated = true;
        } else if (/^0x[0-9a-f]+$/i.test(part)) {
          octets.push(parseInt(part, 16));
          obfuscated = true;
        } else if (/^\d+$/.test(part)) {
          octets.push(Number(part));
        } else {
          return null;
        }
      }
      if (obfuscated && octets.every((o) => o >= 0 && o <= 255)) {
        return octets.join(".");
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hostname blocking
// ---------------------------------------------------------------------------

/** Check whether a hostname is in the blocked list. */
function isHostnameBlocked(hostname: string): string | null {
  const h = hostname.toLowerCase();
  for (const blocked of BLOCKED_HOSTNAMES) {
    if (h === blocked) return `blocked hostname: ${blocked}`;
    if (h.endsWith("." + blocked)) return `blocked hostname suffix: ${blocked}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

export interface SsrfCheckResult {
  ok: boolean;
  reason?: string;
  resolvedIp?: string;
}

/**
 * Validate an outbound URL — throws on blocked target.
 *
 * Steps:
 *   1. Parse URL; require http: or https: scheme.
 *   2. Reject blocked hostnames (localhost, metadata endpoints).
 *   3. Detect obfuscated IPs (decimal/octal/hex).
 *   4. If the hostname is already an IP literal, check against blocked CIDR.
 *   5. DNS-resolve the hostname and check EVERY returned address.
 */
export async function validateOutboundUrl(input: string | URL): Promise<void> {
  const result = await checkUrl(input);
  if (!result.ok) {
    throw new SsrfError(result.reason ?? "URL rejected by SSRF guard");
  }
}

/** Non-throwing variant of `validateOutboundUrl`. */
export async function checkUrl(input: string | URL): Promise<SsrfCheckResult> {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Disallowed scheme: ${url.protocol}` };
  }

  const hostname = url.hostname.toLowerCase();

  // Step 2: hostname blocklist
  const blockedHostname = isHostnameBlocked(hostname);
  if (blockedHostname) {
    return { ok: false, reason: blockedHostname };
  }

  // Step 3: obfuscation detection
  const deobfuscated = detectObfuscation(hostname);
  if (deobfuscated) {
    const ipInt = parseIpv4(deobfuscated);
    if (ipInt != null) {
      const label = isIpv4Blocked(ipInt);
      if (label) {
        return { ok: false, reason: `Obfuscated IP ${deobfuscated} blocked (${label})`, resolvedIp: deobfuscated };
      }
    }
    return { ok: true, resolvedIp: deobfuscated };
  }

  // Step 4: literal IPv4
  const literalV4 = parseIpv4(hostname);
  if (literalV4 != null) {
    const label = isIpv4Blocked(literalV4);
    if (label) {
      return { ok: false, reason: `IP ${hostname} blocked (${label})`, resolvedIp: hostname };
    }
    return { ok: true, resolvedIp: hostname };
  }

  // Step 5: DNS-resolve and check ALL returned addresses
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: `DNS resolution failed for ${hostname}` };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: `No DNS records for ${hostname}` };
  }

  for (const addr of addresses) {
    if (addr.family === 4) {
      const ipInt = parseIpv4(addr.address);
      if (ipInt != null) {
        const label = isIpv4Blocked(ipInt);
        if (label) {
          return { ok: false, reason: `Resolved IP ${addr.address} blocked (${label})`, resolvedIp: addr.address };
        }
      }
    } else if (addr.family === 6) {
      const label = isIpv6Blocked(addr.address);
      if (label) {
        return { ok: false, reason: `Resolved IPv6 ${addr.address} blocked (${label})`, resolvedIp: addr.address };
      }
    }
  }

  return { ok: true, resolvedIp: addresses[0]?.address };
}

/** Boolean convenience wrapper around `checkUrl`. */
export async function isPrivateUrl(input: string | URL): Promise<boolean> {
  const result = await checkUrl(input);
  return !result.ok;
}

/**
 * Drop-in `fetch` wrapper that:
 *   - Validates the destination URL before connecting.
 *   - Follows redirects manually and re-validates each hop (max 5 hops).
 *   - Strips cookies/Authorization from cross-origin redirects.
 * Throws `SsrfError` if any hop targets a blocked IP.
 */
export async function fetchSafe(input: string | URL, init: RequestInit = {}): Promise<Response> {
  await validateOutboundUrl(input);

  const mergedInit: RequestInit = { ...init, redirect: "manual" };

  let url: string | URL = input;
  let hops = 0;
  const MAX_HOPS = 5;

  for (;;) {
    const res = await fetch(url, mergedInit);
    if (res.status < 300 || res.status >= 400) {
      return res;
    }
    const location = res.headers.get("location");
    if (!location) return res;

    hops += 1;
    if (hops > MAX_HOPS) {
      throw new SsrfError(`Redirect chain exceeded ${MAX_HOPS} hops`);
    }

    const nextUrl = new URL(location, url instanceof URL ? url.href : url);
    await validateOutboundUrl(nextUrl);

    url = nextUrl;
    // On cross-origin redirect, strip sensitive headers
    if (init.headers) {
      const initOrigin = new URL(typeof input === "string" ? input : input.href).origin;
      if (nextUrl.origin !== initOrigin) {
        const headers = new Headers(init.headers);
        headers.delete("authorization");
        headers.delete("cookie");
        mergedInit.headers = headers;
      }
    }
  }
}

/** Hash an outbound URL for safe logging (no query-string PII). */
export function hashOutboundUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/**
 * Synchronous URL-only validation (no DNS).
 * @throws {SsrfError} if the URL targets a private range.
 */
export function validateOutboundUrlSync(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfError(`Disallowed scheme: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const blockedHostname = isHostnameBlocked(hostname);
  if (blockedHostname) {
    throw new SsrfError(blockedHostname);
  }

  const deobfuscated = detectObfuscation(hostname);
  if (deobfuscated) {
    const ipInt = parseIpv4(deobfuscated);
    if (ipInt != null) {
      const label = isIpv4Blocked(ipInt);
      if (label) throw new SsrfError(`Obfuscated IP ${deobfuscated} blocked (${label})`);
    }
    return;
  }

  const literalV4 = parseIpv4(hostname);
  if (literalV4 != null) {
    const label = isIpv4Blocked(literalV4);
    if (label) throw new SsrfError(`IP ${hostname} blocked (${label})`);
  }
}
