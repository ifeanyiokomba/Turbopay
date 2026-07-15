"use client";

import * as React from "react";

/**
 * Tiny data-fetching layer (SWR-like) — no extra deps.
 * - `apiFetch`: typed wrapper over fetch (credentials included).
 * - `useApi`: GET hook with cache, dedup, revalidation.
 * - `mutateApi`: invalidate cache keys (call after mutations).
 *
 * ── Auth model (security-hardened) ──
 *
 * MAIN WINDOW: HttpOnly cookies are the sole auth mechanism. No tokens
 * are stored in localStorage, sessionStorage, or any client-accessible
 * store. When the access token expires (24h), the client calls
 * /api/auth/refresh (which reads the refresh token from an HttpOnly
 * cookie) and the server issues a new access token cookie.
 *
 * CROSS-SITE IFRAME: HttpOnly cookies are blocked by the browser. The
 * iframe requests a short-lived (5-minute) bearer token from
 * /api/auth/iframe-token and stores it ONLY in page memory. It is never
 * persisted to any durable store. When the token expires, a fresh one
 * is requested.
 *
 * SECURITY: Storing bearer tokens in localStorage exposes them to any
 * XSS vulnerability for up to 24 hours. In-memory tokens limit the
 * attack window to the XSS payload lifetime (typically milliseconds).
 */

const API_BASE = "";

// ─── In-memory iframe token (for cross-site iframe contexts) ───────────
let _iframeToken: string | null = null;

export function setIframeToken(token: string | null) {
  _iframeToken = token;
}

export function getIframeToken(): string | null {
  return _iframeToken;
}

/**
 * Request a short-lived iframe token from the server.
 * Called when the app detects it's running inside a cross-site iframe
 * and the HttpOnly cookie is not available.
 */
export async function requestIframeToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/iframe-token`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const token = json?.data?.iframeToken;
    if (token) _iframeToken = token;
    return token;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let authExpiredDispatched = false;

export function resetAuthExpiredFlag() {
  authExpiredDispatched = false;
}

// Cross-tab refresh coordination via BroadcastChannel.
let refreshInFlight: Promise<boolean> | null = null;

const refreshChannel: BroadcastChannel | null =
  typeof window !== "undefined" && "BroadcastChannel" in window
    ? new BroadcastChannel("turbopay-refresh")
    : null;

if (refreshChannel) {
  refreshChannel.onmessage = (e: MessageEvent) => {
    if (e.data?.type === "refresh-complete") {
      // Another tab refreshed — the new cookies are already set by the
      // server. No client-side action needed; subsequent requests from
      // this tab will carry the new access token cookie automatically.
    }
  };
}

/**
 * Cookie-based refresh: the server reads the refresh token from an
 * HttpOnly cookie and issues a new access token cookie. No client-side
 * token storage needed.
 */
async function tryRefreshToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Empty body — server reads refresh token from HttpOnly cookie.
        body: JSON.stringify({}),
      });
      if (!res.ok) return false;
      // Server sets new access token + refresh token cookies via Set-Cookie
      // headers. The response body is { data: { ok: true } } — no tokens
      // are exposed to the client. The new cookies are already in the
      // browser, so subsequent requests will carry the refreshed access
      // token automatically.
      if (refreshChannel) {
        refreshChannel.postMessage({ type: "refresh-complete" });
      }
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  // Build headers: include iframe token as Bearer if available.
  const iframeToken = getIframeToken();
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(iframeToken ? { Authorization: `Bearer ${iframeToken}` } : {}),
  };
  if (opts.headers) {
    const callerHeaders = opts.headers as Record<string, string>;
    for (const k of Object.keys(callerHeaders)) {
      finalHeaders[k] = callerHeaders[k];
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    credentials: "include", // always send cookies
    headers: finalHeaders,
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* not json */
  }

  if (!res.ok) {
    const skipRefresh = finalHeaders["X-Turbopay-Skip-Refresh"] === "1";
    const isSessionExpired =
      res.status === 401 &&
      !authExpiredDispatched &&
      !path.startsWith("/api/auth/") &&
      (json?.code === "UNAUTHORIZED" || json?.code === "AUTH_EXPIRED");

    if (isSessionExpired && !skipRefresh) {
      // If we have an iframe token, try requesting a fresh one first.
      if (iframeToken) {
        const newToken = await requestIframeToken();
        if (newToken) {
          // Rebuild headers with the new token (don't reuse stale finalHeaders).
          const retryHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${newToken}`,
            "X-Turbopay-Skip-Refresh": "1",
          };
          return apiFetch<T>(path, { ...opts, headers: retryHeaders });
        }
      }
      // Otherwise, try cookie-based refresh (main window).
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        return apiFetch<T>(path, {
          ...opts,
          headers: { ...finalHeaders, "X-Turbopay-Skip-Refresh": "1" },
        });
      }
    }

    if (isSessionExpired) {
      authExpiredDispatched = true;
      setIframeToken(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("turbopay:auth-expired"));
      }
    }

    const msg =
      isSessionExpired
        ? "Your session has expired. Please sign in again."
        : (json?.error ?? `Request failed (${res.status})`);
    throw new ApiError(msg, res.status, json?.code);
  }

  if (authExpiredDispatched) authExpiredDispatched = false;
  return json?.data as T;
}

// ----- cache + swr -----
type CacheEntry<T> = { data?: T; error?: Error; promise?: Promise<T>; ts: number };
const cache = new Map<string, CacheEntry<unknown>>();

// ─── Request deduplication — prevent duplicate in-flight requests ───
const inflight = new Map<string, Promise<unknown>>();

async function dedupedFetch<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (inflight.has(path)) {
    return inflight.get(path) as Promise<T>;
  }
  const promise = apiFetch<T>(path, { signal }).finally(() => inflight.delete(path));
  inflight.set(path, promise);
  return promise;
}

export function mutateApi(key: string) {
  cache.delete(key);
  inflight.delete(key);
  window.dispatchEvent(new CustomEvent("api-mutate", { detail: key }));
}

export function useApi<T>(path: string | null, opts?: { refreshMs?: number }) {
  const [state, setState] = React.useState<{
    data?: T;
    error?: Error;
    isLoading: boolean;
  }>(() => {
    // Stale-while-revalidate: serve cached data immediately if available
    if (path) {
      const cached = cache.get(path);
      if (cached?.data) {
        return { data: cached.data as T, isLoading: false };
      }
    }
    return { isLoading: !!path };
  });

  const refetch = React.useCallback(async (signal?: AbortSignal) => {
    if (!path) return;
    try {
      const data = await dedupedFetch<T>(path, signal);
      if (!signal?.aborted) setState({ data, isLoading: false });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (!signal?.aborted) {
        setState((prev) => ({
          // Keep stale data on error so the UI doesn't flash empty
          data: prev.data,
          error: e as Error,
          isLoading: false,
        }));
      }
    }
  }, [path]);

  React.useEffect(() => {
    if (!path) {
      setState({ isLoading: false });
      return;
    }
    const controller = new AbortController();
    // If we already have data, don't show loading spinner (SWR behavior)
    setState((s) => ({ ...s, isLoading: !s.data }));
    refetch(controller.signal);
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === path) refetch(controller.signal);
    };
    window.addEventListener("api-mutate", handler);

    // Revalidate on window focus — instant fresh data when user returns to tab
    const onFocus = () => {
      if (document.visibilityState === "visible" && path) {
        const cached = cache.get(path);
        // Only refetch if data is older than 5 seconds
        if (!cached || Date.now() - cached.ts > 5000) {
          refetch(controller.signal);
        }
      }
    };
    document.addEventListener("visibilitychange", onFocus);

    // Revalidate on network reconnect
    const onOnline = () => { if (path) refetch(controller.signal); };
    window.addEventListener("online", onOnline);

    const interval = opts?.refreshMs ? setInterval(() => refetch(controller.signal), opts.refreshMs) : null;
    return () => {
      controller.abort();
      window.removeEventListener("api-mutate", handler);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onOnline);
      if (interval) clearInterval(interval);
    };
  }, [path, refetch, opts?.refreshMs]);

  return { ...state, refetch: () => refetch() };
}

export async function apiPost<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}
