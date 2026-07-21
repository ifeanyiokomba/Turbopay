'use client';

import { useState } from 'react';

interface Wallet {
  id: string;
  currency: string;
  symbol: string;
  name: string;
  balance: number;
  available: number;
  held: number;
}

export default function WalletPage() {
  const [wallets, setWallets] = useState<Wallet[]>([
    { id: '1', currency: 'NGN', symbol: '₦', name: 'Nigerian Naira', balance: 245000, available: 240000, held: 5000 },
    { id: '2', currency: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', balance: 12500, available: 12500, held: 0 },
    { id: '3', currency: 'USD', symbol: '$', name: 'US Dollar', balance: 150, available: 150, held: 0 },
  ]);

  const [showFundModal, setShowFundModal] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);

  const handleFund = (wallet: Wallet) => {
    setSelectedWallet(wallet);
    setShowFundModal(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">My Wallets</h2>
          <p className="text-gray-500">Manage your multi-currency wallets</p>
        </div>
        <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          + Add Currency
        </button>
      </div>

      {/* Wallet Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {wallets.map((wallet) => (
          <div key={wallet.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-500 to-purple-500 p-4 text-white">
              <p className="text-indigo-100 text-sm">{wallet.name}</p>
              <p className="text-2xl font-bold mt-1">{wallet.symbol}{wallet.balance.toLocaleString()}</p>
            </div>
            <div className="p-4">
              <div className="flex justify-between text-sm mb-4">
                <span className="text-gray-500">Available</span>
                <span className="font-medium">{wallet.symbol}{wallet.available.toLocaleString()}</span>
              </div>
              {wallet.held > 0 && (
                <div className="flex justify-between text-sm mb-4">
                  <span className="text-gray-500">On Hold</span>
                  <span className="font-medium text-yellow-600">{wallet.symbol}{wallet.held.toLocaleString()}</span>
                </div>
              )}
              <div className="flex space-x-2">
                <button
                  onClick={() => handleFund(wallet)}
                  className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
                >
                  Fund
                </button>
                <button className="flex-1 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">
                  Withdraw
                </button>
                <button className="flex-1 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">
                  Convert
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Fund Modal */}
      {showFundModal && selectedWallet && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Fund {selectedWallet.currency} Wallet</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                <div className="flex items-center border rounded-lg">
                  <span className="px-3 py-2 bg-gray-50 border-r">{selectedWallet.symbol}</span>
                  <input
                    type="number"
                    className="flex-1 p-2 outline-none"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Funding Method</label>
                <div className="space-y-2">
                  <FundingMethod icon="🏦" label="Bank Transfer" description="Free • Instant" />
                  <FundingMethod icon="💳" label="Debit Card" description="1.5% fee • Instant" />
                  <FundingMethod icon="📱" label="Mobile Money" description="2% fee • Instant" />
                </div>
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  onClick={() => setShowFundModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                  Fund Wallet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FundingMethod({ icon, label, description }: { icon: string; label: string; description: string }) {
  return (
    <div className="flex items-center p-3 border rounded-lg hover:border-indigo-300 cursor-pointer">
      <span className="text-xl mr-3">{icon}</span>
      <div>
        <p className="font-medium text-sm">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
    </div>
  );
}
