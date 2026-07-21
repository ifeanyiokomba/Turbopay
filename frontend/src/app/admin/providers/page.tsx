'use client';

import { useState } from 'react';

interface Provider {
  id: string;
  name: string;
  type: 'payment' | 'mobile_money' | 'bills';
  status: 'active' | 'inactive' | 'error';
  countries: string[];
  capabilities: string[];
  last_health_check: string;
  latency: number;
}

const providers: Provider[] = [
  {
    id: 'paystack',
    name: 'Paystack',
    type: 'payment',
    status: 'active',
    countries: ['NG', 'GH', 'ZA'],
    capabilities: ['card', 'bank_transfer', 'ussd', 'virtual_account'],
    last_health_check: '2024-01-15 14:30',
    latency: 120,
  },
  {
    id: 'flutterwave',
    name: 'Flutterwave',
    type: 'payment',
    status: 'active',
    countries: ['NG', 'GH', 'KE', 'ZA', 'CI'],
    capabilities: ['card', 'bank_transfer', 'mobile_money'],
    last_health_check: '2024-01-15 14:30',
    latency: 145,
  },
  {
    id: 'mtn_momo',
    name: 'MTN MoMo',
    type: 'mobile_money',
    status: 'active',
    countries: ['NG', 'GH', 'UG', 'RW', 'ZM', 'CM', 'CI'],
    capabilities: ['mobile_money_collection', 'mobile_money_payout'],
    last_health_check: '2024-01-15 14:30',
    latency: 230,
  },
  {
    id: 'mpesa',
    name: 'M-Pesa',
    type: 'mobile_money',
    status: 'active',
    countries: ['KE'],
    capabilities: ['mobile_money_collection', 'mobile_money_payout'],
    last_health_check: '2024-01-15 14:30',
    latency: 180,
  },
  {
    id: 'airtel_money',
    name: 'Airtel Money',
    type: 'mobile_money',
    status: 'active',
    countries: ['KE', 'TZ', 'UG', 'ZM', 'MW', 'CD', 'RW', 'BF', 'CI', 'GA', 'NE'],
    capabilities: ['mobile_money_collection', 'mobile_money_payout'],
    last_health_check: '2024-01-15 14:30',
    latency: 450,
  },
  {
    id: 'smartcash',
    name: 'Smart Cash',
    type: 'mobile_money',
    status: 'active',
    countries: ['NG'],
    capabilities: ['mobile_money_collection', 'mobile_money_payout'],
    last_health_check: '2024-01-15 14:30',
    latency: 190,
  },
  {
    id: 'paga',
    name: 'Paga',
    type: 'mobile_money',
    status: 'active',
    countries: ['NG'],
    capabilities: ['mobile_money_collection', 'mobile_money_payout', 'bank_transfer'],
    last_health_check: '2024-01-15 14:30',
    latency: 160,
  },
  {
    id: 'remita',
    name: 'Remita',
    type: 'bills',
    status: 'active',
    countries: ['NG'],
    capabilities: ['bill_payment'],
    last_health_check: '2024-01-15 14:30',
    latency: 280,
  },
  {
    id: 'quickteller',
    name: 'Quickteller',
    type: 'bills',
    status: 'active',
    countries: ['NG'],
    capabilities: ['bill_payment'],
    last_health_check: '2024-01-15 14:30',
    latency: 250,
  },
  {
    id: 'monnify',
    name: 'Monnify',
    type: 'payment',
    status: 'active',
    countries: ['NG'],
    capabilities: ['virtual_account', 'bank_transfer'],
    last_health_check: '2024-01-15 14:30',
    latency: 130,
  },
  {
    id: 'onafriq',
    name: 'Onafriq',
    type: 'payment',
    status: 'active',
    countries: ['NG', 'GH', 'KE', 'ZA', 'TZ', 'UG', 'CI', 'SN', 'CM', 'RW'],
    capabilities: ['mobile_money', 'bank_transfer'],
    last_health_check: '2024-01-15 14:30',
    latency: 320,
  },
];

export default function ProvidersPage() {
  const [filter, setFilter] = useState<'all' | 'payment' | 'mobile_money' | 'bills'>('all');

  const filteredProviders = filter === 'all'
    ? providers
    : providers.filter(p => p.type === filter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Provider Management</h2>
          <p className="text-gray-500">Manage payment providers and their configurations</p>
        </div>
        <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          Add Provider
        </button>
      </div>

      {/* Filters */}
      <div className="flex space-x-2">
        {(['all', 'payment', 'mobile_money', 'bills'] as const).map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              filter === type
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {type === 'all' ? 'All' : type === 'mobile_money' ? 'Mobile Money' : type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Provider Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredProviders.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({ provider }: { provider: Provider }) {
  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    inactive: 'bg-gray-100 text-gray-800',
    error: 'bg-red-100 text-red-800',
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">{provider.name}</h3>
          <p className="text-sm text-gray-500 capitalize">{provider.type.replace('_', ' ')}</p>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[provider.status]}`}>
          {provider.status}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Countries</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {provider.countries.slice(0, 5).map((country) => (
              <span key={country} className="px-2 py-0.5 bg-gray-100 rounded text-xs">
                {country}
              </span>
            ))}
            {provider.countries.length > 5 && (
              <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">
                +{provider.countries.length - 5}
              </span>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Capabilities</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {provider.capabilities.slice(0, 3).map((cap) => (
              <span key={cap} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs">
                {cap.replace(/_/g, ' ')}
              </span>
            ))}
            {provider.capabilities.length > 3 && (
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs">
                +{provider.capabilities.length - 3}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <div className="text-sm text-gray-500">
            Latency: <span className="font-medium text-gray-700">{provider.latency}ms</span>
          </div>
          <button className="text-sm text-indigo-600 hover:text-indigo-800">
            Configure
          </button>
        </div>
      </div>
    </div>
  );
}
