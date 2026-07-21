'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function MerchantDashboard() {
  const [stats] = useState({
    totalCollections: 12847,
    totalVolume: 456789000,
    successfulPayments: 12456,
    pendingSettlements: 23,
    activeLinks: 15,
    conversionRate: 68.5,
  });

  const [recentTransactions] = useState([
    { id: '1', reference: 'TXN_001', amount: 25000, status: 'success', customer: 'john@email.com', date: '2024-01-15' },
    { id: '2', reference: 'TXN_002', amount: 15000, status: 'success', customer: 'jane@email.com', date: '2024-01-15' },
    { id: '3', reference: 'TXN_003', amount: 50000, status: 'pending', customer: 'bob@email.com', date: '2024-01-14' },
    { id: '4', reference: 'TXN_004', amount: 8000, status: 'success', customer: 'alice@email.com', date: '2024-01-14' },
  ]);

  const formatCurrency = (amount: number) => {
    return `₦${amount.toLocaleString()}`;
  };

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Merchant Dashboard</h2>
          <p className="text-gray-500">Overview of your payment collection</p>
        </div>
        <Link
          href="/merchant/payment-links/new"
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          + Create Payment Link
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total Collections" value={stats.totalCollections.toLocaleString()} change="+12.5%" icon="💳" />
        <StatCard title="Total Volume" value={formatCurrency(stats.totalVolume)} change="+8.2%" icon="💰" />
        <StatCard title="Active Links" value={stats.activeLinks.toString()} change="+3" icon="🔗" />
        <StatCard title="Conversion Rate" value={`${stats.conversionRate}%`} change="+2.1%" icon="📈" />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link href="/merchant/payment-links/new" className="bg-white p-4 rounded-xl border border-gray-200 hover:border-indigo-300 text-center">
          <span className="text-2xl">🔗</span>
          <p className="mt-2 text-sm font-medium">New Payment Link</p>
        </Link>
        <Link href="/merchant/transactions" className="bg-white p-4 rounded-xl border border-gray-200 hover:border-indigo-300 text-center">
          <span className="text-2xl">📋</span>
          <p className="mt-2 text-sm font-medium">View Transactions</p>
        </Link>
        <Link href="/merchant/settlements" className="bg-white p-4 rounded-xl border border-gray-200 hover:border-indigo-300 text-center">
          <span className="text-2xl">🏦</span>
          <p className="mt-2 text-sm font-medium">Settlements</p>
        </Link>
        <Link href="/merchant/api-keys" className="bg-white p-4 rounded-xl border border-gray-200 hover:border-indigo-300 text-center">
          <span className="text-2xl">🔑</span>
          <p className="mt-2 text-sm font-medium">API Keys</p>
        </Link>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Recent Transactions</h3>
          <Link href="/merchant/transactions" className="text-sm text-indigo-600 hover:text-indigo-800">
            View All →
          </Link>
        </div>
        <div className="p-6">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-500">
                <th className="pb-4">Reference</th>
                <th className="pb-4">Customer</th>
                <th className="pb-4">Amount</th>
                <th className="pb-4">Status</th>
                <th className="pb-4">Date</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {recentTransactions.map((tx) => (
                <tr key={tx.id} className="border-t border-gray-100">
                  <td className="py-4 font-mono text-xs">{tx.reference}</td>
                  <td className="py-4">{tx.customer}</td>
                  <td className="py-4 font-medium">{formatCurrency(tx.amount)}</td>
                  <td className="py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      tx.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {tx.status}
                    </span>
                  </td>
                  <td className="py-4 text-gray-500">{tx.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, change, icon }: {
  title: string;
  value: string;
  change: string;
  icon: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        <span className={`text-sm font-medium ${change.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
          {change}
        </span>
      </div>
      <h3 className="mt-4 text-2xl font-bold text-gray-800">{value}</h3>
      <p className="text-sm text-gray-500">{title}</p>
    </div>
  );
}
