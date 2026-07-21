'use client';

import { useState } from 'react';

interface Certification {
  id: string;
  name: string;
  status: 'verified' | 'pending' | 'expired' | 'inactive';
  display_on_homepage: boolean;
  expiry_date?: string;
}

interface SecurityBadge {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  icon: string;
}

const certifications: Certification[] = [
  { id: '1', name: 'PCI DSS', status: 'pending', display_on_homepage: false },
  { id: '2', name: 'ISO 27001', status: 'inactive', display_on_homepage: false },
  { id: '3', name: 'SOC 2', status: 'inactive', display_on_homepage: false },
  { id: '4', name: 'GDPR', status: 'verified', display_on_homepage: true },
  { id: '5', name: 'NDPR', status: 'verified', display_on_homepage: true },
];

const securityBadges: SecurityBadge[] = [
  { id: '1', name: 'SSL Secured', status: 'active', icon: '🔒' },
  { id: '2', name: 'AES-256 Encryption', status: 'active', icon: '🔐' },
  { id: '3', name: 'Fraud Protection', status: 'active', icon: '🛡️' },
  { id: '4', name: 'Secure APIs', status: 'active', icon: '🔌' },
  { id: '5', name: 'KYC Verified', status: 'active', icon: '✅' },
  { id: '6', name: 'AML Monitoring', status: 'active', icon: '🔍' },
  { id: '7', name: 'Real-Time Risk Engine', status: 'active', icon: '⚡' },
];

export default function CompliancePage() {
  const [activeTab, setActiveTab] = useState<'certifications' | 'badges' | 'logos'>('certifications');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Compliance & Security</h2>
        <p className="text-gray-500">Manage certifications, security badges, and trust indicators</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {(['certifications', 'badges', 'logos'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Certifications Tab */}
      {activeTab === 'certifications' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Certifications</h3>
            <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm">
              Add Certification
            </button>
          </div>
          <div className="p-6">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500">
                  <th className="pb-4">Name</th>
                  <th className="pb-4">Status</th>
                  <th className="pb-4">Homepage</th>
                  <th className="pb-4">Expiry</th>
                  <th className="pb-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {certifications.map((cert) => (
                  <tr key={cert.id} className="border-t border-gray-100">
                    <td className="py-4 font-medium">{cert.name}</td>
                    <td className="py-4">
                      <StatusBadge status={cert.status} />
                    </td>
                    <td className="py-4">
                      <span className={cert.display_on_homepage ? 'text-green-600' : 'text-gray-400'}>
                        {cert.display_on_homepage ? '✓' : '—'}
                      </span>
                    </td>
                    <td className="py-4 text-gray-500">{cert.expiry_date || '—'}</td>
                    <td className="py-4">
                      <button className="text-sm text-indigo-600 hover:text-indigo-800 mr-4">
                        Edit
                      </button>
                      <button className="text-sm text-red-600 hover:text-red-800">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Security Badges Tab */}
      {activeTab === 'badges' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Security Badges</h3>
            <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm">
              Add Badge
            </button>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {securityBadges.map((badge) => (
                <div
                  key={badge.id}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl">{badge.icon}</span>
                    <div>
                      <p className="font-medium">{badge.name}</p>
                      <p className="text-xs text-gray-500 capitalize">{badge.status}</p>
                    </div>
                  </div>
                  <button className="text-sm text-gray-500 hover:text-gray-700">
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Provider Logos Tab */}
      {activeTab === 'logos' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Provider Logos</h3>
            <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm">
              Add Logo
            </button>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {['MTN MoMo', 'Airtel Money', 'M-Pesa', 'Paga', 'Paystack', 'Flutterwave', 'Remita', 'Quickteller'].map((name) => (
                <div
                  key={name}
                  className="flex flex-col items-center p-4 border border-gray-200 rounded-lg"
                >
                  <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center mb-3">
                    <span className="text-2xl">💳</span>
                  </div>
                  <p className="text-sm font-medium text-center">{name}</p>
                  <button className="mt-2 text-xs text-indigo-600 hover:text-indigo-800">
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    verified: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    expired: 'bg-red-100 text-red-800',
    inactive: 'bg-gray-100 text-gray-800',
    active: 'bg-green-100 text-green-800',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || colors.inactive}`}>
      {status}
    </span>
  );
}
