'use client';

import { useEffect, useState } from 'react';

interface DashboardStats {
  totalTransactions: number;
  totalVolume: number;
  activeProviders: number;
  activeUsers: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalTransactions: 0,
    totalVolume: 0,
    activeProviders: 0,
    activeUsers: 0,
  });

  useEffect(() => {
    // TODO: Fetch real stats from API
    setStats({
      totalTransactions: 12847,
      totalVolume: 456789000,
      activeProviders: 11,
      activeUsers: 3456,
    });
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0,
    }).format(amount / 100);
  };

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Transactions"
          value={stats.totalTransactions.toLocaleString()}
          change="+12.5%"
          icon="💳"
        />
        <StatCard
          title="Total Volume"
          value={formatCurrency(stats.totalVolume)}
          change="+8.2%"
          icon="💰"
        />
        <StatCard
          title="Active Providers"
          value={stats.activeProviders.toString()}
          change="+2"
          icon="🔌"
        />
        <StatCard
          title="Active Users"
          value={stats.activeUsers.toLocaleString()}
          change="+15.3%"
          icon="👥"
        />
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">Recent Transactions</h3>
        </div>
        <div className="p-6">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-500">
                <th className="pb-4">Reference</th>
                <th className="pb-4">User</th>
                <th className="pb-4">Amount</th>
                <th className="pb-4">Provider</th>
                <th className="pb-4">Status</th>
                <th className="pb-4">Date</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              <TransactionRow
                reference="TXN_2024_001"
                user="john@example.com"
                amount={25000}
                provider="Paystack"
                status="success"
                date="2024-01-15 14:32"
              />
              <TransactionRow
                reference="TXN_2024_002"
                user="jane@example.com"
                amount={15000}
                provider="Flutterwave"
                status="success"
                date="2024-01-15 14:28"
              />
              <TransactionRow
                reference="TXN_2024_003"
                user="bob@example.com"
                amount={50000}
                provider="MTN MoMo"
                status="pending"
                date="2024-01-15 14:25"
              />
              <TransactionRow
                reference="TXN_2024_004"
                user="alice@example.com"
                amount={8000}
                provider="M-Pesa"
                status="failed"
                date="2024-01-15 14:20"
              />
            </tbody>
          </table>
        </div>
      </div>

      {/* Provider Status */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">Provider Health</h3>
        </div>
        <div className="p-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <ProviderStatus name="Paystack" status="healthy" latency="120ms" />
          <ProviderStatus name="Flutterwave" status="healthy" latency="145ms" />
          <ProviderStatus name="MTN MoMo" status="healthy" latency="230ms" />
          <ProviderStatus name="M-Pesa" status="healthy" latency="180ms" />
          <ProviderStatus name="Airtel Money" status="degraded" latency="450ms" />
          <ProviderStatus name="Paga" status="healthy" latency="160ms" />
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

function TransactionRow({ reference, user, amount, provider, status, date }: {
  reference: string;
  user: string;
  amount: number;
  provider: string;
  status: string;
  date: string;
}) {
  const statusColors: Record<string, string> = {
    success: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    failed: 'bg-red-100 text-red-800',
  };

  return (
    <tr className="border-t border-gray-100">
      <td className="py-4 font-mono text-xs">{reference}</td>
      <td className="py-4">{user}</td>
      <td className="py-4 font-medium">₦{amount.toLocaleString()}</td>
      <td className="py-4">{provider}</td>
      <td className="py-4">
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[status]}`}>
          {status}
        </span>
      </td>
      <td className="py-4 text-gray-500">{date}</td>
    </tr>
  );
}

function ProviderStatus({ name, status, latency }: {
  name: string;
  status: string;
  latency: string;
}) {
  const statusColors: Record<string, string> = {
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    down: 'bg-red-500',
  };

  return (
    <div className="p-4 border border-gray-200 rounded-lg">
      <div className="flex items-center space-x-2">
        <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
        <span className="font-medium text-sm">{name}</span>
      </div>
      <p className="mt-2 text-xs text-gray-500">{latency}</p>
    </div>
  );
}
