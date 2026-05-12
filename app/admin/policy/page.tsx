'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Save, RefreshCw } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

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
        const sessionRes = await fetch('/api/auth/get-session');
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json();
          if (sessionData?.user?.role !== 'admin') { router.push('/dashboard'); return; }
        } else { router.push('/dashboard'); return; }
        const res = await fetch('/api/admin/policy');
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) { router.push('/dashboard'); return; }
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
    setSaving(key); setError(null); setNotice(null);
    try {
      const res = await fetch('/api/admin/policy', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setNotice(data.data?.notice || 'Saved. Container restart required.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <p className="text-gray-500 dark:text-gray-400">Loading...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Deployment Policy</h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button onClick={() => router.push('/admin')} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">← Back to Admin</button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm flex items-center justify-between">
            {error}<button onClick={() => setError(null)} className="text-red-400 ml-2">×</button>
          </div>
        )}
        {notice && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-300 text-sm flex items-center justify-between">
            <span>{notice}</span><button onClick={() => setNotice(null)} className="text-amber-500 ml-2">×</button>
          </div>
        )}

        <div className="mb-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">Allowed Email Domains</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            Comma-separated list of allowed email domains for registration (e.g. <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">tstc.edu,example.com</code>). Use <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">*</code> to allow all.
          </p>
          <textarea value={emailDomains} onChange={e => setEmailDomains(e.target.value)} rows={3}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 font-mono"
            placeholder="tstc.edu,university.edu" />
          <div className="mt-3 flex justify-end">
            <button onClick={() => save('emailDomains', { allowedEmailDomains: emailDomains })} disabled={saving === 'emailDomains'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              <Save className="w-3.5 h-3.5" />{saving === 'emailDomains' ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="mb-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">Default Model</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            The default AI model for new classrooms. Format: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">provider:model</code> (e.g. <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">openai:gpt-4o</code>).
          </p>
          <input type="text" value={defaultModel} onChange={e => setDefaultModel(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 font-mono"
            placeholder="openai:gpt-4o" />
          <div className="mt-3 flex justify-end">
            <button onClick={() => save('defaultModel', { defaultModel })} disabled={saving === 'defaultModel'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              <Save className="w-3.5 h-3.5" />{saving === 'defaultModel' ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="mb-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">Access Control</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Configure how users access the platform.</p>
          <div className="space-y-3">
            {[{ value: true, label: 'AUTH_ENABLED mode', desc: 'Full email/password authentication with role management' },
              { value: false, label: 'ACCESS_CODE mode', desc: 'Simple access code gate without full auth' }].map(opt => (
              <div key={String(opt.value)} onClick={() => setAuthEnabled(opt.value)}
                className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                  authEnabled === opt.value ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}>
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  authEnabled === opt.value ? 'border-blue-600' : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {authEnabled === opt.value && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{opt.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{opt.desc}</p>
                </div>
              </div>
            ))}
          </div>
          {!authEnabled && (
            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Current Access Code</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 font-mono">{hasAccessCode ? '••••••••' : 'Not set'}</p>
                </div>
                <button onClick={() => setNotice('Access code regeneration requires editing .env.local directly and restarting the container.')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600">
                  <RefreshCw className="w-3.5 h-3.5" />Regenerate
                </button>
              </div>
            </div>
          )}
          <p className="mt-4 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            Note: AUTH_ENABLED is controlled via environment variable. Changing auth mode requires updating AUTH_ENABLED in .env.local and restarting the container.
          </p>
        </div>
      </div>
    </div>
  );
}
