'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface PaymentLinkData {
  id: string;
  title: string;
  description?: string;
  type: 'fixed' | 'flexible' | 'subscription';
  amount?: number;
  currency: string;
  allow_custom_amount: boolean;
  min_amount?: number;
  max_amount?: number;
  collect_customer_email: boolean;
  collect_customer_name: boolean;
  collect_customer_phone: boolean;
}

interface PaymentMethod {
  id: string;
  name: string;
  icon: string;
  description: string;
}

const paymentMethods: PaymentMethod[] = [
  { id: 'card', name: 'Debit Card', icon: '💳', description: 'Pay with Visa, Mastercard' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏦', description: 'Direct bank transfer' },
  { id: 'ussd', name: 'USSD', icon: '📱', description: 'Pay via USSD code' },
  { id: 'mobile_money', name: 'Mobile Money', icon: '📲', description: 'MTN, M-Pesa, Airtel' },
];

export default function CheckoutPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [linkData, setLinkData] = useState<PaymentLinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMethod, setSelectedMethod] = useState<string>('card');
  const [amount, setAmount] = useState<number>(0);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    // TODO: Fetch real link data from API
    // Simulating API call
    setTimeout(() => {
      setLinkData({
        id: 'link_123',
        title: 'Product Purchase',
        description: 'Buy our premium product',
        type: 'fixed',
        amount: 5000,
        currency: 'NGN',
        allow_custom_amount: false,
        collect_customer_email: true,
        collect_customer_name: true,
        collect_customer_phone: false,
      });
      setAmount(5000);
      setLoading(false);
    }, 1000);
  }, [slug]);

  const handlePayment = async () => {
    setProcessing(true);
    // TODO: Integrate with payment API
    await new Promise(resolve => setTimeout(resolve, 2000));
    setProcessing(false);
    alert('Payment successful!');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto"></div>
          <p className="mt-4 text-gray-500">Loading payment link...</p>
        </div>
      </div>
    );
  }

  if (!linkData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <span className="text-4xl">❌</span>
          <h2 className="mt-4 text-xl font-semibold">Payment link not found</h2>
          <p className="mt-2 text-gray-500">This link may have expired or been deactivated</p>
        </div>
      </div>
    );
  }

  const currencySymbol = linkData.currency === 'NGN' ? '₦' : '$';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto py-12 px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-white font-bold">TP</span>
          </div>
          <h1 className="text-xl font-bold text-gray-800">{linkData.title}</h1>
          {linkData.description && (
            <p className="text-gray-500 mt-1">{linkData.description}</p>
          )}
        </div>

        {/* Amount */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="text-center">
            <p className="text-sm text-gray-500">Amount to pay</p>
            {linkData.type === 'fixed' ? (
              <p className="text-3xl font-bold text-gray-800 mt-2">
                {currencySymbol}{linkData.amount?.toLocaleString()}
              </p>
            ) : (
              <div className="mt-4">
                <div className="flex items-center justify-center border-2 border-indigo-600 rounded-lg overflow-hidden">
                  <span className="px-4 py-3 bg-gray-50 border-r text-lg font-medium">{currencySymbol}</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="flex-1 p-3 text-center text-lg outline-none"
                    min={linkData.min_amount || 0}
                    max={linkData.max_amount}
                  />
                </div>
                {linkData.min_amount && (
                  <p className="text-xs text-gray-500 mt-2">
                    Min: {currencySymbol}{linkData.min_amount.toLocaleString()}
                    {linkData.max_amount && ` • Max: ${currencySymbol}${linkData.max_amount.toLocaleString()}`}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Customer Info */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold mb-4">Your Details</h3>
          <div className="space-y-4">
            {linkData.collect_customer_name && (
              <div>
                <label className="block text-sm text-gray-600 mb-1">Full Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-3 border rounded-lg"
                  placeholder="Enter your name"
                />
              </div>
            )}
            {linkData.collect_customer_email && (
              <div>
                <label className="block text-sm text-gray-600 mb-1">Email Address *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-3 border rounded-lg"
                  placeholder="Enter your email"
                />
              </div>
            )}
            {linkData.collect_customer_phone && (
              <div>
                <label className="block text-sm text-gray-600 mb-1">Phone Number *</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full p-3 border rounded-lg"
                  placeholder="Enter your phone number"
                />
              </div>
            )}
          </div>
        </div>

        {/* Payment Method */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold mb-4">Payment Method</h3>
          <div className="space-y-3">
            {paymentMethods.map((method) => (
              <button
                key={method.id}
                onClick={() => setSelectedMethod(method.id)}
                className={`w-full flex items-center p-4 border-2 rounded-lg transition-all ${
                  selectedMethod === method.id
                    ? 'border-indigo-600 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className="text-2xl mr-4">{method.icon}</span>
                <div className="text-left">
                  <p className="font-medium">{method.name}</p>
                  <p className="text-sm text-gray-500">{method.description}</p>
                </div>
                {selectedMethod === method.id && (
                  <span className="ml-auto text-indigo-600">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Pay Button */}
        <button
          onClick={handlePayment}
          disabled={processing || (linkData.collect_customer_email && !email)}
          className="w-full py-4 bg-indigo-600 text-white rounded-xl font-semibold text-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? (
            <span className="flex items-center justify-center">
              <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2"></span>
              Processing...
            </span>
          ) : (
            `Pay ${currencySymbol}${amount.toLocaleString()}`
          )}
        </button>

        {/* Security Badge */}
        <div className="text-center mt-6">
          <p className="text-xs text-gray-500">
            🔒 Secured by TurboPay • PCI DSS Compliant
          </p>
        </div>
      </div>
    </div>
  );
}
