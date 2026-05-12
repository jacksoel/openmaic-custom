'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Save, RefreshCw } from 'lucide-react';

interface PolicyData {
  allowedEmailDomains: string;
  defaultModel: string;
  authEnabled: boolean;
  hasAccessCode: boolean;
}

export default function AdminPolicyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [emailDomains, setEmailDomains] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [authEnabled, setAuthEnabled] = useState(true);
  const [hasAccessCode, setHasAccessCode] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        // Auth guard: check session role
        const sessionRes = await fetch('/api/auth/get-session');
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json();
          const role = sessionData?.user?.role;
          if (role !== 'admin') {
            router.push('/dashboard');
            return;
          }
        } else {
          router.push('/dashboard');
          return;
        }

        // Load policy
        const res = await fetch('/api/admin/policy');
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            router.push('/dashboard');
            return;
          }
          throw new Error('Failed to load policy');
        }
        const data: { data: PolicyData } = await res.json();
        const policy = data.data;
        setEmailDomains(policy.allowedEmailDomains || '');
        setDefaultModel(policy.defaultModel || '');
        setAuthEnabled(policy.authEnabled);
        setHasAccessCode(policy.hasAccessCode);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load policy');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [router]);

  async function save(key: string, value: Record<string, string>) {
    setSaving(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setNotice(data.data?.notice || 'Saved. Container restart required.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Deployment Policy</h1>
          </div>
          <button
            onClick={() => router.push('/admin')}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to Admin
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center justify-between">
            {error}
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-2">×</button>
          </div>
        )}

        {notice && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm flex items-center justify-between">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-amber-500 hover:text-amber-700 ml-2">×</button>
          </div>
        )}

        {/* Email Domains */}
        <div className="mb-4 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1">Allowed Email Domains</h2>
          <p className="text-sm text-gray-500 mb-3">
            Comma-separated list of allowed email domains for registration (e.g. <code className="bg-gray-100 px-1 rounded">tstc.edu,example.com</code>). Use <code className="bg-gray-100 px-1 rounded">*</code> to allow all.
          </p>
          <textarea
            value={emailDomains}
            onChange={e => setEmailDomains(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
            placeholder="tstc.edu,university.edu"
          />
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => save('emailDomains', { allowedEmailDomains: emailDomains })}
              disabled={saving === 'emailDomains'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving === 'emailDomains' ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Default Model */}
        <div className="mb-4 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1">Default Model</h2>
          <p className="text-sm text-gray-500 mb-3">
            The default AI model for new classrooms. Format: <code className="bg-gray-100 px-1 rounded">provider:model</code> (e.g. <code className="bg-gray-100 px-1 rounded">openai:gpt-4o</code>).
          </p>
          <input
            type="text"
            value={defaultModel}
            onChange={e => setDefaultModel(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
            placeholder="openai:gpt-4o"
          />
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => save('defaultModel', { defaultModel })}
              disabled={saving === 'defaultModel'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving === 'defaultModel' ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Access Control */}
        <div className="mb-4 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1">Access Control</h2>
          <p className="text-sm text-gray-500 mb-4">
            Configure how users access the platform.
          </p>

          <div className="space-y-3">
            <div
              onClick={() => setAuthEnabled(true)}
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                authEnabled ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                authEnabled ? 'border-blue-600' : 'border-gray-300'
              }`}>
                {authEnabled && <div className="w-2 h-2 rounded-full bg-blue-600" />}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">AUTH_ENABLED mode</p>
                <p className="text-xs text-gray-500 mt-0.5">Full email/password authentication with role management</p>
              </div>
            </div>

            <div
              onClick={() => setAuthEnabled(false)}
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                !authEnabled ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                !authEnabled ? 'border-blue-600' : 'border-gray-300'
              }`}>
                {!authEnabled && <div className="w-2 h-2 rounded-full bg-blue-600" />}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">ACCESS_CODE mode</p>
                <p className="text-xs text-gray-500 mt-0.5">Simple access code gate without full auth</p>
              </div>
            </div>
          </div>

          {!authEnabled && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Current Access Code</p>
                  <p className="text-sm text-gray-500 mt-0.5 font-mono">
                    {hasAccessCode ? '••••••••' : 'Not set'}
                  </p>
                </div>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50"
                  onClick={() => setNotice('Access code regeneration requires editing .env.local directly and restarting the container.')}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Regenerate
                </button>
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Note: AUTH_ENABLED is controlled via environment variable. Changing auth mode requires updating AUTH_ENABLED in .env.local and restarting the container.
          </p>
        </div>
      </div>
    </div>
  );
}
