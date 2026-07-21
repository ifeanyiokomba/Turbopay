'use client';

import { useState } from 'react';

type BillCategory = 'electricity' | 'internet' | 'cable_tv' | 'airtime' | 'data' | 'education';

const categories = [
  { id: 'electricity' as BillCategory, name: 'Electricity', icon: '💡', color: 'bg-yellow-100' },
  { id: 'internet' as BillCategory, name: 'Internet', icon: '🌐', color: 'bg-blue-100' },
  { id: 'cable_tv' as BillCategory, name: 'Cable TV', icon: '📺', color: 'bg-purple-100' },
  { id: 'airtime' as BillCategory, name: 'Airtime', icon: '📱', color: 'bg-green-100' },
  { id: 'data' as BillCategory, name: 'Data', icon: '📶', color: 'bg-cyan-100' },
  { id: 'education' as BillCategory, name: 'Education', icon: '🎓', color: 'bg-orange-100' },
];

const billers: Record<BillCategory, { id: string; name: string; icon: string }[]> = {
  electricity: [
    { id: 'ikedc', name: 'IKEDC', icon: '⚡' },
    { id: 'ekedc', name: 'EKEDC', icon: '⚡' },
    { id: 'aedc', name: 'AEDC', icon: '⚡' },
    { id: 'eedc', name: 'EEDC', icon: '⚡' },
    { id: 'phed', name: 'PHED', icon: '⚡' },
    { id: 'ibedc', name: 'IBEDC', icon: '⚡' },
  ],
  internet: [
    { id: 'smile', name: 'Smile', icon: '🌐' },
    { id: 'spectranet', name: 'Spectranet', icon: '🌐' },
    { id: 'fiberone', name: 'FiberOne', icon: '🌐' },
    { id: 'airtel_bb', name: 'Airtel Broadband', icon: '🌐' },
    { id: 'mtn_bb', name: 'MTN Broadband', icon: '🌐' },
  ],
  cable_tv: [
    { id: 'dstv', name: 'DSTV', icon: '📺' },
    { id: 'gotv', name: 'GOtv', icon: '📺' },
    { id: 'startimes', name: 'Startimes', icon: '📺' },
    { id: 'showmax', name: 'Showmax', icon: '📺' },
  ],
  airtime: [
    { id: 'mtn', name: 'MTN', icon: '📱' },
    { id: 'airtel', name: 'Airtel', icon: '📱' },
    { id: 'glo', name: 'Glo', icon: '📱' },
    { id: '9mobile', name: '9mobile', icon: '📱' },
  ],
  data: [
    { id: 'mtn_data', name: 'MTN Data', icon: '📶' },
    { id: 'airtel_data', name: 'Airtel Data', icon: '📶' },
    { id: 'glo_data', name: 'Glo Data', icon: '📶' },
    { id: '9mobile_data', name: '9mobile Data', icon: '📶' },
  ],
  education: [
    { id: 'waec', name: 'WAEC', icon: '🎓' },
    { id: 'neco', name: 'NECO', icon: '🎓' },
    { id: 'jamb', name: 'JAMB', icon: '🎓' },
    { id: 'nabteb', name: 'NABTEB', icon: '🎓' },
  ],
};

export default function BillsPage() {
  const [selectedCategory, setSelectedCategory] = useState<BillCategory | null>(null);
  const [selectedBiller, setSelectedBiller] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Pay Bills</h2>
        <p className="text-gray-500">Pay your bills seamlessly</p>
      </div>

      {/* Categories */}
      {!selectedCategory && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`${cat.color} p-6 rounded-xl hover:shadow-md transition-all text-center`}
            >
              <span className="text-3xl">{cat.icon}</span>
              <p className="mt-3 font-medium text-gray-800">{cat.name}</p>
            </button>
          ))}
        </div>
      )}

      {/* Billers */}
      {selectedCategory && !selectedBiller && (
        <div>
          <button
            onClick={() => setSelectedCategory(null)}
            className="text-sm text-indigo-600 hover:text-indigo-800 mb-4"
          >
            ← Back to categories
          </button>
          <h3 className="text-lg font-semibold mb-4">
            {categories.find(c => c.id === selectedCategory)?.name} Providers
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {billers[selectedCategory].map((biller) => (
              <button
                key={biller.id}
                onClick={() => setSelectedBiller(biller.id)}
                className="bg-white p-4 border border-gray-200 rounded-xl hover:border-indigo-300 hover:shadow-sm transition-all text-left"
              >
                <span className="text-2xl">{biller.icon}</span>
                <p className="mt-2 font-medium">{biller.name}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Payment Form */}
      {selectedCategory && selectedBiller && (
        <div className="max-w-lg">
          <button
            onClick={() => setSelectedBiller(null)}
            className="text-sm text-indigo-600 hover:text-indigo-800 mb-4"
          >
            ← Back to billers
          </button>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center space-x-3 mb-6">
              <span className="text-3xl">
                {billers[selectedCategory].find(b => b.id === selectedBiller)?.icon}
              </span>
              <div>
                <h3 className="text-lg font-semibold">
                  {billers[selectedCategory].find(b => b.id === selectedBiller)?.name}
                </h3>
                <p className="text-sm text-gray-500 capitalize">{selectedCategory.replace('_', ' ')}</p>
              </div>
            </div>

            <div className="space-y-4">
              {selectedCategory === 'airtime' || selectedCategory === 'data' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                    <input
                      type="tel"
                      className="w-full p-3 border rounded-lg"
                      placeholder="Enter phone number"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[100, 200, 500, 1000, 2000, 5000].map((amount) => (
                        <button
                          key={amount}
                          className="py-2 border rounded-lg hover:border-indigo-300 text-sm"
                        >
                          ₦{amount.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Meter / Account Number</label>
                    <input
                      type="text"
                      className="w-full p-3 border rounded-lg"
                      placeholder="Enter meter or account number"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                    <input
                      type="number"
                      className="w-full p-3 border rounded-lg"
                      placeholder="Enter amount"
                    />
                  </div>
                </>
              )}

              <button className="w-full py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium">
                Pay Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
