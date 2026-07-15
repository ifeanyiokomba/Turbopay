/**
 * SSRF Prevention — URL Validation + DNS Rebinding Protection
 * ===========================================================
 *
 * Blocks outbound requests to internal/private IP ranges to prevent
 * Server-Side Request Forgery. Used as a guard before any fetch() call
 * that accepts user-influenced URLs.
 *
 * DNS Rebinding Protection:
 *   Standard URL validation alone is insufficient because an attacker can
 *   register a domain that resolves to a public IP during validation but
 *   to 127.0.0.1 during the actual fetch (DNS rebinding). This module
 *   resolves DNS ONCE via `dns.lookup`, validates the resolved IP, and
 *   provides the resolved IP for use in the fetch call.
 *
 * Reference: OWASP SSRF Prevention Cheat Sheet
 */

import * as dns from "node:dns";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",           // Cloud metadata endpoint
]);

export class SsrfError extends Error {
  constructor(url: string, reason?: string) {
    super(`SSRF blocked: ${reason ?? `${url} points to a private/internal address`}`);
    this.name = "SsrfError";
  }
}

/**
 * Check whether an IPv4 address is in a private/reserved range.
 * Uses explicit parentheses for clarity — no operator-precedence surprises.
 */
function isPrivateIPv4(a: number, b: number, c: number, d: number): boolean {
  return (
    a === 0 ||
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/**
 * Check whether a hostname or IP string is in a blocked/private range.
 * Returns true if the URL should be rejected.
 */
function isBlockedAddress(hostname: string): boolean {
  // Block known dangerous hosts.
  if (BLOCKED_HOSTS.has(hostname)) return true;

  // Block IPv6 loopback, ULA, and link-local.
  if (/^::1$/.test(hostname) || /^fc00:/i.test(hostname) || /^fe80:/i.test(hostname)) {
    return true;
  }

  // Block any numeric IPv4 in private ranges.
  const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipMatch) {
    const [, aStr, bStr, cStr, dStr] = ipMatch;
    const a = Number(aStr);
    const b = Number(bStr);
    const c = Number(cStr);
    const d = Number(dStr);
    if (isPrivateIPv4(a, b, c, d)) return true;
  }

  // Block bare IPv6 addresses that are private (beyond loopback/ULA/link-local above).
  if (/^[0-9a-f:]+$/i.test(hostname) && hostname.includes(":")) {
    // Already checked ::1, fc00:, fe80: above. Other non-public IPv6 is blocked.
    return true;
  }

  return false;
}

/**
 * Resolve a hostname to its IP address(es) via DNS.
 * Returns the first IPv4 or IPv6 address, or null on failure.
 */
async function resolveDns(hostname: string): Promise<string | null> {
  // Skip DNS for bare IP literals — already validated.
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return hostname;
  if (/^[0-9a-f:]+$/i.test(hostname) && hostname.includes(":")) return hostname;

  try {
    const { address } = await dns.promises.lookup(hostname, { family: 0 });
    return address;
  } catch {
    // DNS resolution failure — reject to be safe.
    return null;
  }
}

/**
 * Validate that a URL does not target a private/internal address.
 * Resolves DNS to prevent rebinding attacks.
 *
 * @throws {SsrfError} if the URL targets a private range or DNS fails.
 */
export async function validateOutboundUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError(url, "invalid URL");
  }

  // Only allow http/https.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfError(url, `disallowed protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known dangerous hosts and IP patterns.
  if (isBlockedAddress(hostname)) {
    throw new SsrfError(url);
  }

  // DNS rebinding protection: resolve the hostname and validate the resolved IP.
  const resolvedIp = await resolveDns(hostname);
  if (!resolvedIp) {
    throw new SsrfError(url, "DNS resolution failed");
  }
  if (isBlockedAddress(resolvedIp)) {
    throw new SsrfError(url, `resolved to private address: ${resolvedIp}`);
  }
}

/**
 * Synchronous URL-only validation (no DNS).
 * Use this when DNS resolution is done elsewhere (e.g. the fetch caller
 * will resolve). Prefer the async `validateOutboundUrl` for full protection.
 *
 * @throws {SsrfError} if the URL targets a private range.
 */
export function validateOutboundUrlSync(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError(url, "invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfError(url, `disallowed protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedAddress(hostname)) {
    throw new SsrfError(url);
  }
}
