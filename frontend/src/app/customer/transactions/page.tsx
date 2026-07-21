'use client';

import { useState } from 'react';

interface Transaction {
  id: string;
  type: 'credit' | 'debit';
  category: 'transfer' | 'bill' | 'airtime' | 'funding' | 'card';
  description: string;
  amount: number;
  currency: string;
  reference: string;
  date: string;
  status: 'success' | 'pending' | 'failed';
  provider: string;
}

const transactions: Transaction[] = [
  { id: '1', type: 'credit', category: 'funding', description: 'Wallet Funding via Paystack', amount: 50000, currency: 'NGN', reference: 'TXN_2024_001', date: '2024-01-15 14:32', status: 'success', provider: 'Paystack' },
  { id: '2', type: 'debit', category: 'airtime', description: 'MTN Airtime', amount: 5000, currency: 'NGN', reference: 'TXN_2024_002', date: '2024-01-14 10:15', status: 'success', provider: 'Remita' },
  { id: '3', type: 'debit', category: 'transfer', description: 'Transfer to John Doe', amount: 25000, currency: 'NGN', reference: 'TXN_2024_003', date: '2024-01-14 09:30', status: 'success', provider: 'Paystack' },
  { id: '4', type: 'debit', category: 'bill', description: 'IKEDC Electricity', amount: 15000, currency: 'NGN', reference: 'TXN_2024_004', date: '2024-01-13 16:45', status: 'pending', provider: 'Remita' },
  { id: '5', type: 'credit', category: 'transfer', description: 'Payment from Jane Smith', amount: 100000, currency: 'NGN', reference: 'TXN_2024_005', date: '2024-01-12 11:20', status: 'success', provider: 'Flutterwave' },
  { id: '6', type: 'debit', category: 'bill', description: 'DSTV Subscription', amount: 21000, currency: 'NGN', reference: 'TXN_2024_006', date: '2024-01-11 08:00', status: 'success', provider: 'Quickteller' },
];

const categoryIcons: Record<string, string> = {
  transfer: '💸',
  bill: '📱',
  airtime: '📞',
  funding: '💰',
  card: '💳',
};

export default function TransactionsPage() {
  const [filter, setFilter] = useState<'all' | 'credit' | 'debit'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filteredTransactions = transactions.filter(tx => {
    if (filter !== 'all' && tx.type !== filter) return false;
    if (categoryFilter !== 'all' && tx.category !== categoryFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Transaction History</h2>
        <p className="text-gray-500">View all your transactions</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex space-x-2 bg-gray-100 p-1 rounded-lg">
          {(['all', 'credit', 'debit'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                filter === type
                  ? 'bg-white shadow-sm text-indigo-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {type === 'all' ? 'All' : type === 'credit' ? '↓ Credit' : '↑ Debit'}
            </button>
          ))}
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-4 py-2 border rounded-lg text-sm"
        >
          <option value="all">All Categories</option>
          <option value="transfer">Transfers</option>
          <option value="bill">Bills</option>
          <option value="airtime">Airtime</option>
          <option value="funding">Funding</option>
          <option value="card">Cards</option>
        </select>
      </div>

      {/* Transactions List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6">
          {filteredTransactions.length === 0 ? (
            <div className="text-center py-12">
              <span className="text-4xl">📋</span>
              <p className="mt-4 text-gray-500">No transactions found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTransactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:bg-gray-50">
                  <div className="flex items-center space-x-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${
                      tx.type === 'credit' ? 'bg-green-100' : 'bg-red-100'
                    }`}>
                      {categoryIcons[tx.category]}
                    </div>
                    <div>
                      <p className="font-medium">{tx.description}</p>
                      <div className="flex items-center space-x-2 text-sm text-gray-500">
                        <span>{tx.date}</span>
                        <span>•</span>
                        <span>{tx.provider}</span>
                        <span>•</span>
                        <span className="font-mono text-xs">{tx.reference}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-semibold ${
                      tx.type === 'credit' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {tx.type === 'credit' ? '+' : '-'}{tx.currency === 'NGN' ? '₦' : '$'}{tx.amount.toLocaleString()}
                    </p>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      tx.status === 'success' ? 'bg-green-100 text-green-800' :
                      tx.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {tx.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
