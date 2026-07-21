// TurboPay React Hooks
// Custom hooks for API integration

'use client';

import { useState, useEffect, useCallback } from 'react';
import api from './api';

// =============================================================================
// USE AUTH
// =============================================================================

export function useAuth() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is logged in
    const token = localStorage.getItem('turbopay_token');
    if (token) {
      // TODO: Validate token and get user info
      setUser({ id: '1', email: 'john@example.com', first_name: 'John', last_name: 'Doe' });
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const response = await api.login(email, password);
    if (response.success && response.user) {
      setUser(response.user);
    }
    return response;
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  return { user, loading, login, logout };
}

// =============================================================================
// USE WALLET
// =============================================================================

export function useWallet() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWallets = useCallback(async () => {
    try {
      const response = await api.getWallets();
      setWallets(response.data || []);
    } catch (error) {
      console.error('Failed to fetch wallets:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  const fundWallet = async (currency: string, amount: number, method: string) => {
    const response = await api.fundWallet({ currency, amount, method });
    if (response.success) {
      await fetchWallets(); // Refresh wallets
    }
    return response;
  };

  return { wallets, loading, fundWallet, refresh: fetchWallets };
}

// =============================================================================
// USE TRANSACTIONS
// =============================================================================

export function useTransactions() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTransactions = useCallback(async (params?: { limit?: number; type?: string }) => {
    try {
      const response = await api.getTransactions(params);
      setTransactions(response.data || []);
    } catch (error) {
      console.error('Failed to fetch transactions:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  return { transactions, loading, refresh: fetchTransactions };
}

// =============================================================================
// USE TRANSFER
// =============================================================================

export function useTransfer() {
  const [loading, setLoading] = useState(false);

  const transfer = async (data: {
    amount: number;
    currency: string;
    recipient: any;
    narration?: string;
  }) => {
    setLoading(true);
    try {
      const response = await api.createTransfer(data);
      return response;
    } finally {
      setLoading(false);
    }
  };

  const verifyAccount = async (bankCode: string, accountNumber: string) => {
    const response = await api.verifyAccount({ bank_code: bankCode, account_number: accountNumber });
    return response.data;
  };

  const getBanks = async () => {
    const response = await api.getBanks();
    return response.data || [];
  };

  return { transfer, verifyAccount, getBanks, loading };
}

// =============================================================================
// USE BILLS
// =============================================================================

export function useBills() {
  const [billers, setBillers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBillers = useCallback(async (category?: string) => {
    try {
      const response = await api.getBillers(category);
      setBillers(response.data || []);
    } catch (error) {
      console.error('Failed to fetch billers:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const payBill = async (data: {
    biller_id: string;
    amount: number;
    customer_reference: string;
    category: string;
  }) => {
    const response = await api.payBill(data);
    return response;
  };

  return { billers, loading, fetchBillers, payBill };
}

// =============================================================================
// USE PAYMENT LINKS
// =============================================================================

export function usePaymentLinks() {
  const [links, setLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLinks = useCallback(async () => {
    try {
      const response = await api.getPaymentLinks();
      setLinks(response.data || []);
    } catch (error) {
      console.error('Failed to fetch payment links:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  const createLink = async (data: any) => {
    const response = await api.createPaymentLink(data);
    if (response.success) {
      await fetchLinks(); // Refresh list
    }
    return response;
  };

  return { links, loading, createLink, refresh: fetchLinks };
}
