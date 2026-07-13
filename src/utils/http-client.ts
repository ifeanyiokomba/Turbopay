// TurboPay HTTP Client
// Unified HTTP client for all provider API calls

import { RateLimitError, AuthenticationError } from '../types';

// =============================================================================
// TYPES
// =============================================================================

export interface HttpClientConfig {
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: any;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  timeout?: number;
  idempotency_key?: string;
}

export interface HttpResponse<T = any> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

export interface HttpError {
  status: number;
  message: string;
  code?: string;
  errors?: any[];
}

// =============================================================================
// HTTP CLIENT
// =============================================================================

export class HttpClient {
  private config: HttpClientConfig;
  private token: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: HttpClientConfig) {
    this.config = {
      timeout: 30000,
      headers: {},
      ...config
    };
  }

  /**
   * Set authentication token
   */
  setToken(token: string, expiresIn?: number): void {
    this.token = token;
    if (expiresIn) {
      this.tokenExpiry = new Date(Date.now() + (expiresIn * 1000));
    }
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(): boolean {
    if (!this.tokenExpiry) return false;
    return this.tokenExpiry <= new Date();
  }

  /**
   * Make HTTP request
   */
  async request<T = any>(options: RequestOptions): Promise<HttpResponse<T>> {
    const url = this.buildUrl(options.path, options.query);
    const headers = this.buildHeaders(options);

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      options.timeout || this.config.timeout
    );

    try {
      const response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let data: T;
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        data = await response.json() as T;
      } else {
        data = await response.text() as any;
      }

      if (!response.ok) {
        throw this.handleError(response.status, data);
      }

      return {
        status: response.status,
        data,
        headers: responseHeaders
      };
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error instanceof HttpApiError) {
        throw error;
      }

      if (error.name === 'AbortError') {
        throw new HttpApiError(408, 'Request timeout');
      }

      throw new HttpApiError(500, error.message || 'Network error');
    }
  }

  /**
   * GET request
   */
  async get<T = any>(
    path: string,
    options?: Partial<RequestOptions>
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'GET', path });
  }

  /**
   * POST request
   */
  async post<T = any>(
    path: string,
    body?: any,
    options?: Partial<RequestOptions>
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'POST', path, body });
  }

  /**
   * PUT request
   */
  async put<T = any>(
    path: string,
    body?: any,
    options?: Partial<RequestOptions>
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'PUT', path, body });
  }

  /**
   * PATCH request
   */
  async patch<T = any>(
    path: string,
    body?: any,
    options?: Partial<RequestOptions>
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'PATCH', path, body });
  }

  /**
   * DELETE request
   */
  async delete<T = any>(
    path: string,
    options?: Partial<RequestOptions>
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'DELETE', path });
  }

  /**
   * Build full URL
   */
  private buildUrl(path: string, query?: Record<string, string | number | boolean>): string {
    let url = `${this.config.baseUrl}${path}`;
    
    if (query) {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([key, value]) => {
        params.append(key, String(value));
      });
      url += `?${params.toString()}`;
    }

    return url;
  }

  /**
   * Build request headers
   */
  private buildHeaders(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
      ...options.headers
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    if (options.idempotency_key) {
      headers['X-Idempotency-Key'] = options.idempotency_key;
    }

    return headers;
  }

  /**
   * Handle HTTP errors
   */
  private handleError(status: number, data: any): HttpApiError {
    let message = 'Request failed';
    let code: string | undefined;
    let errors: any[] | undefined;

    if (typeof data === 'object') {
      message = data.message || data.error?.message || data.error || message;
      code = data.code || data.error?.code;
      errors = data.errors || data.error?.errors || data.validation_errors;
    } else if (typeof data === 'string') {
      message = data;
    }

    // Handle specific error codes
    switch (status) {
      case 401:
        throw new AuthenticationError(message);
      case 429:
        const retryAfter = parseInt(data?.retryAfter || data?.retry_after || '60');
        throw new RateLimitError(message, retryAfter);
      default:
        throw new HttpApiError(status, message, code, errors);
    }
  }
}

// =============================================================================
// HTTP API ERROR
// =============================================================================

export class HttpApiError extends Error {
  public status: number;
  public code?: string;
  public errors?: any[];

  constructor(status: number, message: string, code?: string, errors?: any[]) {
    super(message);
    this.name = 'HttpApiError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export function createHttpClient(config: HttpClientConfig): HttpClient {
  return new HttpClient(config);
}

export default HttpClient;
