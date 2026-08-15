/**
 * Mobile Money HTTP Helper
 * =========================
 *
 * Shared HTTP utility for mobile money provider adapters.
 * Uses the centralized jsonRequest layer for SSRF protection,
 * timeout, and error normalization.
 */

import { jsonRequest, ProviderHttpError } from "./_http";

export interface MobileMoneyRequestOpts {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface MobileMoneyRequestResult<T> {
  status: number;
  data: T;
  headers: Headers;
}

/**
 * Make an HTTP request for a mobile money provider.
 * Uses the centralized jsonRequest layer for SSRF protection.
 */
export async function mobileMoneyRequest<T = unknown>(
  opts: MobileMoneyRequestOpts
): Promise<MobileMoneyRequestResult<T>> {
  return jsonRequest<T>({
    url: opts.url,
    method: opts.method ?? "GET",
    headers: opts.headers,
    body: opts.body,
    timeoutMs: opts.timeoutMs ?? 15_000,
  });
}
