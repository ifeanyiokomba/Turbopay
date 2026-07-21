'use client';

import { useState } from 'react';

interface ApiKey {
  id: string;
  name: string;
  key: string;
  type: 'live' | 'test';
  last_used: string;
  created_at: string;
  permissions: string[];
}

const apiKeys: ApiKey[] = [
  {
    id: '1',
    name: 'Production API Key',
    key: 'sk_live_abc123def456...',
    type: 'live',
    last_used: '2024-01-15 14:30',
    created_at: '2024-01-01',
    permissions: ['read', 'write']
  },
  {
    id: '2',
    name: 'Test API Key',
    key: 'sk_test_xyz789...',
    type: 'test',
    last_used: '2024-01-15 10:00',
    created_at: '2024-01-01',
    permissions: ['read', 'write']
  },
];

export default function ApiKeysPage() {
  const [showNewKey, setShowNewKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyType, setNewKeyType] = useState<'live' | 'test'>('test');

  const handleCreateKey = () => {
    // TODO: Call API to create key
    setShowNewKey(false);
    setNewKeyName('');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">API Keys</h2>
          <p className="text-gray-500">Manage your API keys for integration</p>
        </div>
        <button
          onClick={() => setShowNewKey(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          + Generate New Key
        </button>
      </div>

      {/* Warning */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex">
          <span className="text-yellow-400 text-xl">⚠️</span>
          <div className="ml-3">
            <h4 className="text-sm font-medium text-yellow-800">Keep your API keys secure</h4>
            <p className="text-sm text-yellow-700 mt-1">
              Never share your API keys publicly or commit them to version control. Use environment variables in your code.
            </p>
          </div>
        </div>
      </div>

      {/* API Keys List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6">
          {apiKeys.map((key) => (
            <div key={key.id} className="p-4 border border-gray-200 rounded-lg mb-4 last:mb-0">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <h4 className="font-medium">{key.name}</h4>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      key.type === 'live' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                    }`}>
                      {key.type}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 font-mono mt-1">{key.key}</p>
                  <div className="flex items-center space-x-4 mt-2 text-xs text-gray-400">
                    <span>Last used: {key.last_used}</span>
                    <span>Created: {key.created_at}</span>
                    <span>Permissions: {key.permissions.join(', ')}</span>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50">
                    Copy
                  </button>
                  <button className="px-3 py-1 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50">
                    Revoke
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Documentation */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold mb-4">API Documentation</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a href="#" className="p-4 border border-gray-200 rounded-lg hover:border-indigo-300">
            <h4 className="font-medium">Getting Started</h4>
            <p className="text-sm text-gray-500 mt-1">Quick start guide for integration</p>
          </a>
          <a href="#" className="p-4 border border-gray-200 rounded-lg hover:border-indigo-300">
            <h4 className="font-medium">API Reference</h4>
            <p className="text-sm text-gray-500 mt-1">Complete API documentation</p>
          </a>
          <a href="#" className="p-4 border border-gray-200 rounded-lg hover:border-indigo-300">
            <h4 className="font-medium">Webhooks</h4>
            <p className="text-sm text-gray-500 mt-1">Set up webhook endpoints</p>
          </a>
        </div>
      </div>

      {/* New Key Modal */}
      {showNewKey && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Generate New API Key</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Key Name</label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full p-3 border rounded-lg"
                  placeholder="e.g., Production Key"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Key Type</label>
                <div className="flex space-x-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="test"
                      checked={newKeyType === 'test'}
                      onChange={() => setNewKeyType('test')}
                      className="mr-2"
                    />
                    <span className="text-sm">Test</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="live"
                      checked={newKeyType === 'live'}
                      onChange={() => setNewKeyType('live')}
                      className="mr-2"
                    />
                    <span className="text-sm">Live</span>
                  </label>
                </div>
              </div>
              <div className="flex space-x-3 mt-6">
                <button
                  onClick={() => setShowNewKey(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateKey}
                  disabled={!newKeyName}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  Generate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
