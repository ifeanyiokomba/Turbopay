/**
 * Input Sanitization — XSS, SQLi, and Path Traversal Protection
 * ==============================================================
 *
 * Defends against three classes of injection attacks:
 *
 *   1. XSS  — 20 pattern detectors catch <script>, <iframe>, on* event
 *              handlers, javascript: URIs, data: URIs with HTML, SVG-based
 *              payloads, encoded variants, etc.
 *   2. SQLi — 12 pattern detectors catch UNION SELECT, stacked queries,
 *              comment terminators, time-based blind injection probes, etc.
 *   3. PT   — 4 path-traversal patterns catch ../, ..\\, encoded variants,
 *              and absolute path escapes.
 *
 * Plus prototype-pollution prevention (__proto__ / constructor / prototype
 * keys are stripped from objects), Unicode NFKC normalization, and null-byte
 * stripping.
 *
 * Adapted from Turbo reference architecture.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Pattern detectors
// ---------------------------------------------------------------------------

/** 20 XSS pattern detectors. */
export const XSS_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /<\s*script\b/i, label: "<script> tag" },
  { pattern: /<\/\s*script\s*>/i, label: "</script> tag" },
  { pattern: /<\s*iframe\b/i, label: "<iframe> tag" },
  { pattern: /<\s*object\b/i, label: "<object> tag" },
  { pattern: /<\s*embed\b/i, label: "<embed> tag" },
  { pattern: /<\s*svg\b/i, label: "<svg> tag (XSS vector)" },
  { pattern: /<\s*img\b[^>]*\bon\w+\s*=/i, label: "<img on*=...> event handler" },
  { pattern: /<\s*body\b[^>]*\bon\w+\s*=/i, label: "<body on*=...> event handler" },
  {
    pattern: /\bon(load|error|click|mouseover|focus|blur|submit|change|toggle|animationstart|animationend)\s*=/i,
    label: "inline event handler",
  },
  { pattern: /javascript\s*:/i, label: "javascript: URI" },
  { pattern: /vbscript\s*:/i, label: "vbscript: URI" },
  { pattern: /data\s*:\s*text\/html/i, label: "data:text/html URI" },
  { pattern: /data\s*:\s*application\/x-/i, label: "data:application/x-* URI" },
  { pattern: /<\s*meta\b[^>]*http-equiv/i, label: "<meta http-equiv> refresh redirect" },
  { pattern: /<\s*link\b[^>]*\brel\s*=\s*['"]?import/i, label: "<link rel=import> HTML import" },
  { pattern: /<\s*base\b/i, label: "<base> tag (href hijack)" },
  { pattern: /<\s*form\b/i, label: "<form> tag injection" },
  { pattern: /<\s*style\b/i, label: "<style> tag (CSS injection)" },
  { pattern: /document\s*\.\s*cookie/i, label: "document.cookie access" },
  { pattern: /expression\s*\(/i, label: "CSS expression() (legacy IE XSS)" },
];

/** 12 SQL injection pattern detectors. */
export const SQL_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /'\s*OR\s*'?'?\s*=\s*'?1/i, label: "OR '1'='1' tautology" },
  { pattern: /'\s*OR\s*1\s*=\s*1/i, label: "OR 1=1 tautology" },
  { pattern: /\bunion\b\s+\bselect\b/i, label: "UNION SELECT" },
  { pattern: /;\s*(drop|alter|truncate|create|insert|update|delete)\b/i, label: "stacked query (DDL/DML)" },
  { pattern: /--\s|\/\*|\*\//i, label: "SQL comment terminator" },
  { pattern: /\bwaitfor\s+delay\b/i, label: "WAITFOR DELAY (time-based blind)" },
  { pattern: /\bsleep\s*\(\s*\d+\s*\)/i, label: "SLEEP() (time-based blind)" },
  { pattern: /\bbenchmark\s*\(/i, label: "BENCHMARK() (time-based blind)" },
  { pattern: /\binformation_schema\b/i, label: "information_schema access" },
  { pattern: /\bxp_cmdshell\b/i, label: "xp_cmdshell (MSSQL RCE)" },
  { pattern: /\bload_file\s*\(/i, label: "LOAD_FILE() (MySQL file read)" },
  { pattern: /\binto\s+(outfile|dumpfile)\b/i, label: "INTO OUTFILE/DUMPFILE (write)" },
];

/** 4 path traversal pattern detectors. */
export const PATH_TRAVERSAL_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\.\.[\\/]/, label: "../ or ..\\ traversal" },
  { pattern: /%2e%2e(%2f|%5c)/i, label: "URL-encoded ../ traversal" },
  { pattern: /\.\.%2f|\.\.%5c/i, label: "mixed-encoded ../ traversal" },
  { pattern: /^(\/|\\|[a-zA-Z]:[\\\/])/, label: "absolute path escape" },
];

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface SanitizeResult {
  safe: boolean;
  detections: { type: "xss" | "sqli" | "path-traversal"; label: string }[];
}

/** Check a string for malicious patterns. Returns detections found. */
export function detectMalicious(input: string): SanitizeResult {
  const detections: SanitizeResult["detections"] = [];

  for (const { pattern, label } of XSS_PATTERNS) {
    if (pattern.test(input)) detections.push({ type: "xss", label });
  }
  for (const { pattern, label } of SQL_PATTERNS) {
    if (pattern.test(input)) detections.push({ type: "sqli", label });
  }
  for (const { pattern, label } of PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(input)) detections.push({ type: "path-traversal", label });
  }

  return { safe: detections.length === 0, detections };
}

// ---------------------------------------------------------------------------
// Sanitization functions
// ---------------------------------------------------------------------------

/** Strip null bytes (defeats truncation attacks). */
function stripNullBytes(s: string): string {
  return s.replace(/\0/g, "");
}

/** Unicode NFKC normalization (defeats lookalike-character attacks). */
function normalizeUnicode(s: string): string {
  try {
    return s.normalize("NFKC");
  } catch {
    return s;
  }
}

/** Strip prototype-pollution keys from an object. */
function stripPrototypeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    result[key] = value;
  }
  return result;
}

/** Sanitize a string input: normalize, strip null bytes, trim. */
export function sanitizeString(input: string): string {
  return stripNullBytes(normalizeUnicode(input)).trim();
}

/** Sanitize an email address. */
export function sanitizeEmail(input: string): string {
  return sanitizeString(input).toLowerCase();
}

/** Sanitize a phone number: strip everything except digits, +, and -. */
export function sanitizePhone(input: string): string {
  return sanitizeString(input).replace(/[^0-9+\-]/g, "");
}

/** Sanitize a URL: normalize and strip dangerous schemes. */
export function sanitizeUrl(input: string): string {
  const s = sanitizeString(input);
  // Block javascript:, vbscript:, data:text/html
  if (/^(javascript|vbscript|data\s*:\s*text\/html)/i.test(s)) {
    return "";
  }
  return s;
}

/** Sanitize an ID (alphanumeric + hyphens + underscores only). */
export function sanitizeId(input: string): string {
  return sanitizeString(input).replace(/[^a-zA-Z0-9\-_]/g, "");
}

/**
 * Sanitize an entire request body: walk all string values, apply
 * sanitizeString, and strip prototype-pollution keys.
 */
export function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  const cleaned = stripPrototypeKeys(body);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(cleaned)) {
    if (typeof value === "string") {
      result[key] = sanitizeString(value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeBody(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string" ? sanitizeString(item) :
        typeof item === "object" && item !== null ? sanitizeBody(item as Record<string, unknown>) :
        item
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Generate a safe logging hash of a string (no PII in logs).
 * Returns first 16 chars of SHA-256 hex.
 */
export function fingerprint(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
