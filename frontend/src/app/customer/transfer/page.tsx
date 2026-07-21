'use client';

import { useState } from 'react';

type TransferType = 'local' | 'international' | 'mobile_money';

export default function TransferPage() {
  const [transferType, setTransferType] = useState<TransferType>('local');
  const [currency, setCurrency] = useState('NGN');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Send Money</h2>
        <p className="text-gray-500">Transfer money locally or internationally</p>
      </div>

      {/* Transfer Type Tabs */}
      <div className="flex space-x-2 bg-gray-100 p-1 rounded-lg">
        {(['local', 'international', 'mobile_money'] as const).map((type) => (
          <button
            key={type}
            onClick={() => setTransferType(type)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              transferType === type
                ? 'bg-white shadow-sm text-indigo-600'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {type === 'local' ? '🏦 Bank Transfer' :
             type === 'international' ? '🌍 International' :
             '📱 Mobile Money'}
          </button>
        ))}
      </div>

      {/* Transfer Form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="space-y-4">
          {/* Currency Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From Wallet</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full p-3 border rounded-lg"
            >
              <option value="NGN">₦ NGN - Nigerian Naira (₦245,000)</option>
              <option value="KES">KSh KES - Kenyan Shilling (KSh12,500)</option>
              <option value="USD">$ USD - US Dollar ($150)</option>
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
            <div className="flex items-center border rounded-lg">
              <span className="px-3 py-2 bg-gray-50 border-r text-lg font-medium">
                {currency === 'NGN' ? '₦' : currency === 'KES' ? 'KSh' : '$'}
              </span>
              <input
                type="number"
                className="flex-1 p-3 outline-none text-lg"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Recipient */}
          {transferType === 'local' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bank</label>
                <select className="w-full p-3 border rounded-lg">
                  <option>Select bank</option>
                  <option>Access Bank</option>
                  <option>GTBank</option>
                  <option>First Bank</option>
                  <option>UBA</option>
                  <option>Zenith Bank</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
                <input
                  type="text"
                  className="w-full p-3 border rounded-lg"
                  placeholder="Enter account number"
                  maxLength={10}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Name</label>
                <input
                  type="text"
                  className="w-full p-3 border rounded-lg bg-gray-50"
                  placeholder="Name will appear after verification"
                  disabled
                />
              </div>
            </>
          )}

          {transferType === 'international' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Destination Country</label>
                <select className="w-full p-3 border rounded-lg">
                  <option>Select country</option>
                  <option>Kenya</option>
                  <option>Ghana</option>
                  <option>South Africa</option>
                  <option>United Kingdom</option>
                  <option>United States</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Name</label>
                <input
                  type="text"
                  className="w-full p-3 border rounded-lg"
                  placeholder="Enter recipient name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Number / IBAN</label>
                <input
                  type="text"
                  className="w-full p-3 border rounded-lg"
                  placeholder="Enter account number or IBAN"
                />
              </div>
            </>
          )}

          {transferType === 'mobile_money' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                <select className="w-full p-3 border rounded-lg">
                  <option>Select country</option>
                  <option>Nigeria</option>
                  <option>Kenya</option>
                  <option>Ghana</option>
                  <option>Uganda</option>
                  <option>Tanzania</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Network</label>
                <select className="w-full p-3 border rounded-lg">
                  <option>Select network</option>
                  <option>MTN MoMo</option>
                  <option>M-Pesa</option>
                  <option>Airtel Money</option>
                  <option>Smart Cash</option>
                  <option>Paga</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input
                  type="tel"
                  className="w-full p-3 border rounded-lg"
                  placeholder="Enter phone number"
                />
              </div>
            </>
          )}

          {/* Narration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Narration (Optional)</label>
            <input
              type="text"
              className="w-full p-3 border rounded-lg"
              placeholder="What's this for?"
            />
          </div>

          {/* Fee Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Transfer Fee</span>
              <span className="font-medium">₦50</span>
            </div>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-gray-500">You'll pay</span>
              <span className="font-bold text-lg">₦10,050</span>
            </div>
          </div>

          {/* Submit */}
          <button className="w-full py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium">
            Send Money
          </button>
        </div>
      </div>
    </div>
  );
}
