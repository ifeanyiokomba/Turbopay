'use client';

import { useState } from 'react';
import Link from 'next/link';

interface PaymentLink {
  id: string;
  title: string;
  type: 'fixed' | 'flexible';
  amount?: number;
  currency: string;
  status: 'active' | 'inactive' | 'expired';
  total_uses: number;
  total_collected: number;
  created_at: string;
}

const links: PaymentLink[] = [
  { id: '1', title: 'Product A', type: 'fixed', amount: 5000, currency: 'NGN', status: 'active', total_uses: 145, total_collected: 725000, created_at: '2024-01-10' },
  { id: '2', title: 'Service Subscription', type: 'fixed', amount: 10000, currency: 'NGN', status: 'active', total_uses: 89, total_collected: 890000, created_at: '2024-01-08' },
  { id: '3', title: 'Donation', type: 'flexible', currency: 'NGN', status: 'active', total_uses: 234, total_collected: 1234000, created_at: '2024-01-05' },
  { id: '4', title: 'Old Campaign', type: 'fixed', amount: 2500, currency: 'NGN', status: 'expired', total_uses: 56, total_collected: 140000, created_at: '2023-12-01' },
];

export default function PaymentLinksPage() {
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive' | 'expired'>('all');

  const filteredLinks = filter === 'all' ? links : links.filter(l => l.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Payment Links</h2>
          <p className="text-gray-500">Create and manage payment links</p>
        </div>
        <Link
          href="/merchant/payment-links/new"
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          + Create Link
        </Link>
      </div>

      {/* Filters */}
      <div className="flex space-x-2">
        {(['all', 'active', 'inactive', 'expired'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              filter === status
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Links Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-500">
                <th className="pb-4">Title</th>
                <th className="pb-4">Type</th>
                <th className="pb-4">Amount</th>
                <th className="pb-4">Uses</th>
                <th className="pb-4">Collected</th>
                <th className="pb-4">Status</th>
                <th className="pb-4">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {filteredLinks.map((link) => (
                <tr key={link.id} className="border-t border-gray-100">
                  <td className="py-4 font-medium">{link.title}</td>
                  <td className="py-4 capitalize">{link.type}</td>
                  <td className="py-4">
                    {link.amount ? `₦${link.amount.toLocaleString()}` : 'Custom'}
                  </td>
                  <td className="py-4">{link.total_uses}</td>
                  <td className="py-4 font-medium">₦{link.total_collected.toLocaleString()}</td>
                  <td className="py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      link.status === 'active' ? 'bg-green-100 text-green-800' :
                      link.status === 'inactive' ? 'bg-gray-100 text-gray-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {link.status}
                    </span>
                  </td>
                  <td className="py-4">
                    <button className="text-sm text-indigo-600 hover:text-indigo-800 mr-4">
                      Copy Link
                    </button>
                    <button className="text-sm text-gray-500 hover:text-gray-700">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
