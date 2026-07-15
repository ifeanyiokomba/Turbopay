/**
 * Shared HTTP helper for production provider adapters.
 * ----------------------------------------------------
 * - Uses the built-in fetch API (no axios / no extra deps).
 * - Enforces a 10s default timeout via AbortController.
 * - SSRF protection: validates outbound URLs against private ranges.
 * - Normalises non-2xx responses + network failures into a typed
 *   `ProviderHttpError` that adapters can map to ProviderResult.error.
 * - Forwards an Idempotency-Key header when supplied (so providers that
 *   support it can deduplicate retries on the same logical operation).
 *
 * Adapters consume this helper and never touch `fetch` directly — that
 * keeps the timeout / error-normalisation contract identical across
 * every production integration.
 */
import { validateOutboundUrl } from "@/lib/turbopay/ssrf";

export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export interface JsonRequestOpts {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Forwarded as `Idempotency-Key` when set (see ProviderContext.idempotencyKey). */
  idempotencyKey?: string;
}

export interface JsonRequestResult<T> {
  status: number;
  data: T;
  headers: Headers;
}

/** Pull a human message out of an arbitrary provider JSON error body. */
function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.responseMessage === "string") return obj.responseMessage;
    const nested = obj.responseBody;
    if (nested && typeof nested === "object") {
      const inner = nested as Record<string, unknown>;
      if (typeof inner.message === "string") return inner.message;
    }
  }
  if (typeof body === "string" && body.length > 0) return body;
  return fallback;
}

/**
 * Perform a JSON HTTP request with a hard timeout and error normalisation.
 * Throws `ProviderHttpError` on any non-2xx status, timeout, or network failure.
 */
export async function jsonRequest<T = unknown>(opts: JsonRequestOpts): Promise<JsonRequestResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
    if (opts.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    await validateOutboundUrl(opts.url);

    const res = await fetch(opts.url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ac.signal,
    });

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      throw new ProviderHttpError(
        res.status,
        `HTTP_${res.status}`,
        extractMessage(parsed, `HTTP ${res.status}`),
        parsed,
      );
    }
    return { status: res.status, data: parsed as T, headers: res.headers };
  } catch (err) {
    if (err instanceof ProviderHttpError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderHttpError(0, "TIMEOUT", `Request timed out after ${timeoutMs}ms`);
    }
    throw new ProviderHttpError(
      0,
      "NETWORK_ERROR",
      err instanceof Error ? err.message : "fetch failed",
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Map any thrown value into the ProviderResult.error shape. */
export function toProviderError(
  err: unknown,
  fallbackCode = "PROVIDER_ERROR",
): { code: string; message: string; raw?: unknown } {
  if (err instanceof ProviderHttpError) {
    return { code: err.code, message: err.message, raw: err.raw };
  }
  if (err instanceof Error) {
    return { code: fallbackCode, message: err.message };
  }
  return { code: fallbackCode, message: "unknown error" };
}

/**
 * Check if an error is transient (worth retrying).
 * Transient: 5xx server errors, timeouts, network failures.
 * Non-transient: 4xx client errors (bad request, unauthorized, etc.) — retrying won't help.
 */
function isTransientError(err: unknown): boolean {
  if (err instanceof ProviderHttpError) {
    return err.status >= 500 || err.code === "TIMEOUT" || err.code === "NETWORK_ERROR";
  }
  return false;
}

/**
 * Retry a function with exponential backoff on transient errors.
 *
 * - Retries on: 5xx, timeout, network error
 * - Does NOT retry on: 4xx (client errors — permanent)
 * - Backoff: baseBackoffMs * 2^attempt (1s, 2s, 4s by default)
 * - Max retries: 3 (4 total attempts)
 *
 * Only use for IDEMPOTENT operations — the provider must safely handle
 * duplicate requests (via Idempotency-Key header).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseBackoffMs?: number } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseBackoff = opts.baseBackoffMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isTransientError(err)) {
        const delay = baseBackoff * Math.pow(2, attempt); // 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
