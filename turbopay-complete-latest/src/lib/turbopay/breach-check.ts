import * as crypto from "node:crypto";

/**
 * PASSWORD BREACH CHECKING — HaveIBeenPwned k-anonymity model.
 *
 * Why this exists: even a "strong" password (8+ chars, mixed case, digit,
 * symbol) is worthless if it appears verbatim in a known breach corpus
 * (e.g. "Password1!", "Qwerty123$"). Attackers run breach dictionaries
 * against every login form on the internet. The k-anonymity model lets us
 * check a candidate password against the HIBP corpus WITHOUT ever sending
 * the full password (or its full hash) to a third party.
 *
 * How k-anonymity works:
 *   1. SHA-1 hash the password (uppercase hex).
 *   2. Send only the FIRST 5 CHARACTERS of the hash to the HIBP API.
 *   3. The API responds with the FULL list of suffixes (last 35 chars) +
 *      breach counts that share that prefix — a "neighborhood" of ~500-800
 *      entries, only ONE of which is the caller's.
 *   4. We search that local list for our full hash suffix.
 *
 * Privacy: HIBP never learns which specific password we asked about. They
 * only see a 5-char prefix shared by hundreds of unrelated hashes.
 *
 * Failure mode: fail-OPEN. If the HIBP API is unreachable, network-blocked,
 * or returns garbage, we return `false` (NOT breached) so registration is
 * not blocked by a transient network issue. The audit task explicitly
 * requires a SOFT check — see task `auth-hardening-errors`.
 *
 * Caching: HIBP responses are cached in-memory for 5 minutes keyed on the
 * 5-char prefix. A single prefix hits the API at most once per 5 min per
 * process — important because the registration form calls this on every
 * keystroke (debounced) and the register route calls it again on submit.
 */

const HIBP_API = "https://api.pwnedpasswords.com/range/";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 5_000; // 5 seconds

interface CacheEntry {
  /** Raw response body (suffix:count lines). */
  body: string;
  /** Expiry timestamp (ms since epoch). */
  expiresAt: number;
}

const prefixCache = new Map<string, CacheEntry>();

// Periodically evict expired cache entries to avoid unbounded growth.
// `.unref?.()` so the timer doesn't keep the process alive in tests.
if (process.env.NODE_ENV !== "test" && process.env.VITEST === undefined) {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of prefixCache) {
      if (v.expiresAt < now) prefixCache.delete(k);
    }
  }, 60_000).unref?.();
}

/**
 * SHA-1 hash the password and return its UPPERCASE hex representation.
 * The HIBP API expects uppercase hex — lowercase would silently fail to
 * match any suffix in the response.
 */
function sha1Upper(password: string): string {
  return crypto.createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
}

/**
 * Fetch the suffix list for a given 5-char prefix. Uses the in-memory cache
 * if a fresh entry exists; otherwise issues an HTTPS GET with a 5-second
 * AbortController timeout. Returns the raw text body on success, or `null`
 * on any network/HTTP error (so the caller can fail open).
 */
async function fetchSuffixes(prefix: string): Promise<string | null> {
  const cached = prefixCache.get(prefix);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.body;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${HIBP_API}${prefix}`, {
      signal: controller.signal,
      headers: {
        // The HIBP API supports a `Add-Padding: true` header that adds random
        // bogus entries to the response, defeating any timing analysis by a
        // network observer trying to infer whether the caller's hash was in
        // the list. We always send it.
        "Add-Padding": "true",
        // Identify the client (good API citizenship).
        "User-Agent": "Turbopay-Password-Check/1.0",
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    prefixCache.set(prefix, { body: text, expiresAt: now + CACHE_TTL_MS });
    return text;
  } catch {
    // Network error, DNS failure, AbortController timeout, TLS error, etc.
    // Fail open — never block registration on a third-party outage.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check whether a password has appeared in a known data breach.
 *
 * @returns `true` if the password is in the HIBP breach corpus.
 *          `false` if it is NOT in the corpus, OR if the API was
 *          unreachable (fail-open).
 */
export async function isPasswordBreached(password: string): Promise<boolean> {
  // Defensive: empty/short passwords can't meaningfully be checked. The
  // zod schema on the register route already enforces 8+ chars, but this
  // guard makes the function safe to call from anywhere.
  if (!password || password.length < 1) return false;

  const fullHash = sha1Upper(password);
  const prefix = fullHash.slice(0, 5);
  const suffix = fullHash.slice(5);

  const body = await fetchSuffixes(prefix);
  if (body === null) return false; // API unreachable → fail open.

  // The response is a newline-delimited list of `SUFFIX:COUNT` entries.
  // We search for our exact suffix and parse the count.
  //
  // Body format example:
  //   00A1F2E3D4C5B6A7:3
  //   00B4C5D6E7F8A9B0:1
  //   00C7D8E9F0A1B2C3:42
  //
  // We do a line-by-line scan rather than a regex over the whole body —
  // faster, no backtracking risk, and avoids false positives where one
  // suffix is a prefix of another (the `:` delimiter disambiguates).
  for (const line of body.split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const lineSuffix = line.slice(0, sep).toUpperCase();
    const countStr = line.slice(sep + 1).trim();
    if (lineSuffix === suffix) {
      const count = Number.parseInt(countStr, 10);
      // A breach count of 0 means the hash was de-listed (e.g. a takedown).
      // Treat anything with count > 0 as breached.
      return Number.isFinite(count) && count > 0;
    }
  }
  return false;
}

/**
 * Test-only helper: clear the in-memory cache. Exported so unit tests can
 * exercise the network path without contamination from prior calls. NOT
 * for use in application code.
 */
export function _clearBreachCacheForTests(): void {
  prefixCache.clear();
}
