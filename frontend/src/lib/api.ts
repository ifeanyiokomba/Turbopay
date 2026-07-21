// TurboPay API Client
// Connects frontend to backend API

// =============================================================================
// CONFIG
// =============================================================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// =============================================================================
// TYPES
// =============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  user?: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
  };
  error?: string;
}

export interface Transaction {
  id: string;
  reference: string;
  type: 'credit' | 'debit';
  amount: number;
  currency: string;
  status: 'success' | 'pending' | 'failed';
  provider: string;
  description: string;
  created_at: string;
}

export interface Wallet {
  id: string;
  currency: string;
  balance: number;
  available_balance: number;
  held_balance: number;
}

export interface PaymentLink {
  id: string;
  title: string;
  description?: string;
  type: 'fixed' | 'flexible' | 'subscription';
  amount?: number;
  currency: string;
  status: string;
  total_uses: number;
  total_amount_collected: number;
  created_at: string;
}

// =============================================================================
// API CLIENT
// =============================================================================

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    // Load token from localStorage if available
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('turbopay_token');
    }
  }

  // ===========================================================================
  // AUTH
  // ===========================================================================

  setToken(token: string): void {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('turbopay_token', token);
    }
  }

  clearToken(): void {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('turbopay_token');
    }
  }

  // ===========================================================================
  // HTTP METHODS
  // ===========================================================================

  private async request<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  }

  // ===========================================================================
  // AUTH API
  // ===========================================================================

  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>(
      'POST',
      '/api/v1/auth/customer/login',
      { email, password }
    );

    if (response.token) {
      this.setToken(response.token);
    }

    return response;
  }

  async register(data: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    phone?: string;
  }): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>(
      'POST',
      '/api/v1/auth/customer/register',
      data
    );

    if (response.token) {
      this.setToken(response.token);
    }

    return response;
  }

  async logout(): Promise<void> {
    await this.request('POST', '/api/v1/auth/customer/logout');
    this.clearToken();
  }

  async forgotPassword(email: string): Promise<ApiResponse> {
    return this.request('POST', '/api/v1/auth/customer/forgot-password', { email });
  }

  // ===========================================================================
  // WALLET API
  // ===========================================================================

  async getWallets(): Promise<Wallet[]> {
    const response = await this.request<ApiResponse<Wallet[]>>('GET', '/api/v1/wallet/balance');
    return response.data || [];
  }

  async fundWallet(data: {
    currency: string;
    amount: number;
    method: string;
  }): Promise<ApiResponse> {
    return this.request('POST', '/api/v1/wallet/fund', data);
  }

  async convertCurrency(data: {
    from_currency: string;
    to_currency: string;
    amount: number;
  }): Promise<ApiResponse> {
    return this.request('POST', '/api/v1/wallet/convert', data);
  }

  // ===========================================================================
  // TRANSFER API
  // ===========================================================================

  async createTransfer(data: {
    amount: number;
    currency: string;
    recipient: {
      type: 'bank' | 'mobile_money';
      bank_code?: string;
      account_number?: string;
      phone_number?: string;
      network?: string;
      country_code?: string;
    };
    narration?: string;
  }): Promise<ApiResponse<Transaction>> {
    return this.request('POST', '/api/v1/transfers/single', data);
  }

  async verifyAccount(data: {
    bank_code: string;
    account_number: string;
  }): Promise<ApiResponse<{ account_name: string }>> {
    return this.request('POST', '/api/v1/banks/resolve', data);
  }

  async getBanks(): Promise<ApiResponse<any[]>> {
    return this.request('GET', '/api/v1/banks');
  }

  // ===========================================================================
  // BILLS API
  // ===========================================================================

  async getBillers(category?: string): Promise<ApiResponse<any[]>> {
    const query = category ? `?category=${category}` : '';
    return this.request('GET', `/api/v1/bills/billers${query}`);
  }

  async payBill(data: {
    biller_id: string;
    amount: number;
    customer_reference: string;
    category: string;
  }): Promise<ApiResponse<Transaction>> {
    return this.request('POST', '/api/v1/bills/pay', data);
  }

  // ===========================================================================
  // TRANSACTIONS API
  // ===========================================================================

  async getTransactions(params?: {
    limit?: number;
    offset?: number;
    type?: string;
  }): Promise<ApiResponse<Transaction[]>> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    if (params?.type) query.set('type', params.type);
    
    return this.request('GET', `/api/v1/transactions?${query.toString()}`);
  }

  // ===========================================================================
  // PAYMENT LINKS API (Merchant)
  // ===========================================================================

  async createPaymentLink(data: {
    title: string;
    description?: string;
    type: 'fixed' | 'flexible' | 'subscription';
    amount?: number;
    currency: string;
    allow_custom_amount?: boolean;
  }): Promise<ApiResponse<PaymentLink>> {
    return this.request('POST', '/api/v1/payment-links', data);
  }

  async getPaymentLinks(): Promise<ApiResponse<PaymentLink[]>> {
    return this.request('GET', '/api/v1/payment-links');
  }

  async getPaymentLink(id: string): Promise<ApiResponse<PaymentLink>> {
    return this.request('GET', `/api/v1/payment-links/${id}`);
  }

  // ===========================================================================
  // COMPLIANCE API
  // ===========================================================================

  async getTrustData(): Promise<ApiResponse<any>> {
    return this.request('GET', '/api/v1/trust');
  }

  // ===========================================================================
  // KYC API
  // ===========================================================================

  async submitKYC(data: {
    bvn?: string;
    nin?: string;
    verification_method: string;
  }): Promise<ApiResponse> {
    return this.request('POST', '/api/v1/auth/customer/kyc', data);
  }

  // ===========================================================================
  // NOTIFICATIONS API
  // ===========================================================================

  async getNotifications(params?: {
    limit?: number;
    unread_only?: boolean;
  }): Promise<ApiResponse<any[]>> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.unread_only) query.set('unread_only', params.unread_only.toString());
    
    return this.request('GET', `/api/v1/notifications?${query.toString()}`);
  }

  async markNotificationRead(id: string): Promise<ApiResponse> {
    return this.request('POST', `/api/v1/notifications/${id}/read`);
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

export const api = new ApiClient(API_BASE);

export default api;
