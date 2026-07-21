'use client';

import { useState } from 'react';
import Link from 'next/link';

interface WalletBalance {
  currency: string;
  symbol: string;
  balance: number;
  equivalent_usd: number;
}

interface Transaction {
  id: string;
  type: 'credit' | 'debit';
  description: string;
  amount: number;
  currency: string;
  date: string;
  status: 'success' | 'pending' | 'failed';
}

export default function CustomerDashboard() {
  const [wallets] = useState<WalletBalance[]>([
    { currency: 'NGN', symbol: '₦', balance: 245000, equivalent_usd: 295 },
    { currency: 'KES', symbol: 'KSh', balance: 12500, equivalent_usd: 95 },
    { currency: 'USD', symbol: '$', balance: 150, equivalent_usd: 150 },
  ]);

  const [transactions] = useState<Transaction[]>([
    { id: '1', type: 'credit', description: 'Wallet Funding', amount: 50000, currency: 'NGN', date: '2024-01-15', status: 'success' },
    { id: '2', type: 'debit', description: 'Airtime Purchase', amount: 5000, currency: 'NGN', date: '2024-01-14', status: 'success' },
    { id: '3', type: 'credit', description: 'Payment Received', amount: 25000, currency: 'NGN', date: '2024-01-14', status: 'success' },
    { id: '4', type: 'debit', description: 'Electricity Bill', amount: 15000, currency: 'NGN', date: '2024-01-13', status: 'pending' },
  ]);

  const totalBalanceUSD = wallets.reduce((sum, w) => sum + w.equivalent_usd, 0);

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Welcome back, John!</h2>
        <p className="text-gray-500">Here's your account overview</p>
      </div>

      {/* Balance Card */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 text-white">
        <p className="text-indigo-100 text-sm">Total Balance</p>
        <h3 className="text-3xl font-bold mt-1">${totalBalanceUSD.toLocaleString()}</h3>
        <p className="text-indigo-200 text-sm mt-2">≈ {wallets.map(w => `${w.symbol}${w.balance.toLocaleString()}`).join(' | ')}</p>
        
        <div className="flex space-x-3 mt-6">
          <Link href="/customer/wallet" className="px-4 py-2 bg-white/20 rounded-lg hover:bg-white/30 text-sm font-medium">
            Fund Wallet
          </Link>
          <Link href="/customer/transfer" className="px-4 py-2 bg-white/20 rounded-lg hover:bg-white/30 text-sm font-medium">
            Send Money
          </Link>
          <Link href="/customer/bills" className="px-4 py-2 bg-white/20 rounded-lg hover:bg-white/30 text-sm font-medium">
            Pay Bills
          </Link>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <QuickAction icon="💸" label="Send Money" href="/customer/transfer" />
        <QuickAction icon="📱" label="Buy Airtime" href="/customer/bills" />
        <QuickAction icon="💡" label="Pay Electricity" href="/customer/bills" />
        <QuickAction icon="📺" label="Cable TV" href="/customer/bills" />
      </div>

      {/* Wallets */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold">My Wallets</h3>
          <Link href="/customer/wallet" className="text-sm text-indigo-600 hover:text-indigo-800">
            View All →
          </Link>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          {wallets.map((wallet) => (
            <div key={wallet.currency} className="p-4 border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{wallet.currency}</span>
                <span className="text-xs text-gray-400">≈ ${wallet.equivalent_usd}</span>
              </div>
              <p className="text-2xl font-bold mt-2">{wallet.symbol}{wallet.balance.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Recent Transactions</h3>
          <Link href="/customer/transactions" className="text-sm text-indigo-600 hover:text-indigo-800">
            View All →
          </Link>
        </div>
        <div className="p-6">
          {transactions.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  tx.type === 'credit' ? 'bg-green-100' : 'bg-red-100'
                }`}>
                  {tx.type === 'credit' ? '↓' : '↑'}
                </div>
                <div>
                  <p className="font-medium">{tx.description}</p>
                  <p className="text-sm text-gray-500">{tx.date}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`font-semibold ${
                  tx.type === 'credit' ? 'text-green-600' : 'text-red-600'
                }`}>
                  {tx.type === 'credit' ? '+' : '-'}{tx.currency === 'NGN' ? '₦' : '$'}{tx.amount.toLocaleString()}
                </p>
                <span className={`text-xs ${
                  tx.status === 'success' ? 'text-green-600' :
                  tx.status === 'pending' ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {tx.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon, label, href }: { icon: string; label: string; href: string }) {
  return (
    <Link href={href} className="bg-white p-4 rounded-xl border border-gray-200 hover:border-indigo-300 hover:shadow-sm transition-all text-center">
      <span className="text-2xl">{icon}</span>
      <p className="mt-2 text-sm font-medium text-gray-700">{label}</p>
    </Link>
  );
}
