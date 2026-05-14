'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { Key, Plus, Trash2, Eye, EyeOff, CheckCircle2, XCircle, Loader2, ArrowLeft, Shield, Server, User, AlertTriangle } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

interface UserProvider { id: string; userId: string; providerSlug: string; defaultModel: string | null; limits: string | null; hasKey: boolean; createdAt: string; updatedAt: string; }
interface SessionUser { id: string; email: string; name: string; role: string; }
type TestResult = { status: 'idle' | 'testing' | 'success' | 'error'; source?: 'user' | 'institutional' };

const PROVIDER_CATALOG = [
  { slug: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'] },
  { slug: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414'] },
  { slug: 'google', name: 'Google AI', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] },
  { slug: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { slug: 'qwen', name: 'Qwen (Alibaba)', models: ['qwen-max', 'qwen-plus'] },
  { slug: 'grok', name: 'Grok (xAI)', models: ['grok-3', 'grok-3-mini'] },
  { slug: 'openrouter', name: 'OpenRouter', models: [] },
  { slug: 'ollama', name: 'Ollama (Self-hosted)', models: [] },
];

function getProviderName(slug: string) { return PROVIDER_CATALOG.find(p => p.slug === slug)?.name || slug; }
function getProviderModels(slug: string) { return PROVIDER_CATALOG.find(p => p.slug === slug)?.models || []; }

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [providers, setProviders] = useState<UserProvider[]>([]);
  const [serverProviders, setServerProviders] = useState<Record<string, { models?: string[]; baseUrl?: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addSlug, setAddSlug] = useState('');
  const [addKey, setAddKey] = useState('');
  const [addModel, setAddModel] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deleteSlug, setDeleteSlug] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [testStatus, setTestStatus] = useState<Record<string, TestResult>>({});

  useEffect(() => {
    async function checkAuth() {
      try {
        const { data } = await authClient.getSession();
        if (!data?.user) { router.push('/login?callbackUrl=/settings'); return; }
        const u = data.user as any;
        if (u.role === 'student') { router.push('/dashboard'); return; }
        setUser({ id: u.id, email: u.email, name: u.name, role: u.role || 'student' });
      } catch { router.push('/login?callbackUrl=/settings'); }
    }
    checkAuth();
  }, [router]);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/user/providers');
      if (!res.ok) throw new Error('Failed to fetch providers');
      const data = await res.json();
      setProviders(data.providers || []);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unknown error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (user) fetchProviders(); }, [user, fetchProviders]);

  // Fetch which institutional providers are active (no keys exposed)
  useEffect(() => {
    fetch('/api/server-providers')
      .then(r => r.json())
      .then(d => setServerProviders(d.providers || {}))
      .catch(() => {});
  }, []);

  const handleAdd = async () => {
    if (!addSlug || !addKey) return;
    setAddSubmitting(true); setError(null);
    try {
      const res = await fetch('/api/user/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerSlug: addSlug, apiKey: addKey, defaultModel: addModel || null }) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to add provider'); }
      setShowAdd(false); setAddSlug(''); setAddKey(''); setAddModel('');
      await fetchProviders();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to add provider'); }
    finally { setAddSubmitting(false); }
  };

  const handleUpdate = async (slug: string) => {
    setEditSubmitting(true); setError(null);
    try {
      const body: Record<string, any> = {};
      if (editKey) body.apiKey = editKey;
      if (editModel !== undefined) body.defaultModel = editModel || null;
      const res = await fetch(`/api/user/providers/${slug}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to update provider'); }
      setEditingSlug(null); setEditKey(''); setEditModel('');
      await fetchProviders();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to update provider'); }
    finally { setEditSubmitting(false); }
  };

  const handleDelete = async (slug: string) => {
    setDeleteSubmitting(true); setError(null);
    try {
      const res = await fetch(`/api/user/providers/${slug}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to delete provider'); }
      setDeleteSlug(null); await fetchProviders();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to delete provider'); }
    finally { setDeleteSubmitting(false); }
  };

  const handleTest = async (slug: string) => {
    setTestStatus(prev => ({ ...prev, [slug]: { status: 'testing' } }));
    try {
      const res = await fetch(`/api/user/providers/${slug}/test`, { method: 'POST' });
      const data = await res.json();
      setTestStatus(prev => ({ ...prev, [slug]: { status: data.success ? 'success' : 'error', source: data.source } }));
    } catch {
      setTestStatus(prev => ({ ...prev, [slug]: { status: 'error' } }));
    }
  };

  const configuredSlugs = new Set(providers.map(p => p.providerSlug));
  const availableProviders = PROVIDER_CATALOG.filter(p => !configuredSlugs.has(p.slug));
  const serverProviderSlugs = Object.keys(serverProviders);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /><span>Loading settings...</span></div>
    </div>
  );
  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-muted/30">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft className="h-5 w-5" /></button>
            <div>
              <h1 className="text-xl font-semibold">My AI Stack</h1>
              <p className="text-sm text-muted-foreground">Configure your own AI provider keys and default models</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">{user.role}</span>
            <span className="text-sm text-muted-foreground">{user.email}</span>
          </div>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex gap-3">
            <Shield className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground space-y-1">
              <p>Your API keys are <strong>encrypted</strong> on the server and never sent to the browser.</p>
              <p>Personal keys override institutional keys <strong>for your account only</strong>. Removing your key does not affect other users\'s access through the institutional key.</p>
            </div>
          </div>
        </div>

        {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 flex items-center gap-2 text-sm text-destructive"><XCircle className="h-4 w-4 shrink-0" /><span>{error}</span><button onClick={() => setError(null)} className="ml-auto text-destructive/70 hover:text-destructive">×</button></div>}

        {/* Personal Keys */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Your Personal Keys</h2>
          {providers.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Key className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No personal keys configured. Institutional keys are used where available.</p>
            </div>
          )}
          {providers.map(provider => {
            const ts = testStatus[provider.providerSlug];
            const testSt = ts?.status || 'idle';
            return (
              <div key={provider.providerSlug} className="rounded-lg border bg-card overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center"><Key className="h-4 w-4 text-primary" /></div>
                    <div>
                      <p className="font-medium text-sm">{getProviderName(provider.providerSlug)}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{provider.providerSlug}</span>
                        {provider.defaultModel && <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{provider.defaultModel}</span>}
                        {testSt === 'success' && ts?.source && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            ts.source === 'user'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                          }`}>
                            {ts.source === 'user' ? 'your key' : 'server key'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleTest(provider.providerSlug)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title={testSt === 'success' && ts?.source ? `Connected via ${ts.source === 'user' ? 'your key' : 'server key'}` : 'Test connection'}
                    >
                      {testSt === 'testing' ? <Loader2 className="h-4 w-4 animate-spin" /> : testSt === 'success' ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : testSt === 'error' ? <XCircle className="h-4 w-4 text-red-500" /> : <Server className="h-4 w-4" />}
                    </button>
                    <button onClick={() => { setEditingSlug(editingSlug === provider.providerSlug ? null : provider.providerSlug); setEditKey(''); setEditModel(provider.defaultModel || ''); }} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><User className="h-4 w-4" /></button>
                    <button onClick={() => setDeleteSlug(provider.providerSlug)} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                {editingSlug === provider.providerSlug && (
                  <div className="border-t px-4 py-3 bg-muted/20 space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">New API Key (leave blank to keep current)</label>
                      <div className="relative mt-1">
                        <input type={visibleKeys.has(provider.providerSlug) ? 'text' : 'password'} value={editKey} onChange={e => setEditKey(e.target.value)} placeholder="sk-..." className="w-full rounded-md border bg-background px-3 py-2 text-sm pr-10" />
                        <button type="button" onClick={() => setVisibleKeys(prev => { const n = new Set(prev); n.has(provider.providerSlug) ? n.delete(provider.providerSlug) : n.add(provider.providerSlug); return n; })} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{visibleKeys.has(provider.providerSlug) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Default Model</label>
                      <select value={editModel} onChange={e => setEditModel(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm">
                        <option value="">Use provider default</option>
                        {getProviderModels(provider.providerSlug).map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { setEditingSlug(null); setEditKey(''); setEditModel(''); }} className="px-3 py-1.5 text-sm rounded-md border hover:bg-muted transition-colors">Cancel</button>
                      <button onClick={() => handleUpdate(provider.providerSlug)} disabled={editSubmitting} className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{editSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add Personal Key */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Add Personal Key</h2>
          {availableProviders.length > 0 && !showAdd && (<button onClick={() => setShowAdd(true)} className="w-full rounded-lg border border-dashed p-4 flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"><Plus className="h-5 w-5" /><span className="text-sm font-medium">Add AI Provider</span></button>)}
          {showAdd && (
            <div className="rounded-lg border bg-card p-4 space-y-4">
              <div><label className="text-xs font-medium text-muted-foreground">Provider</label><select value={addSlug} onChange={e => { setAddSlug(e.target.value); setAddModel(''); }} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"><option value="">Select a provider...</option>{availableProviders.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">API Key</label>
                <div className="relative mt-1">
                  <input type={visibleKeys.has('new') ? 'text' : 'password'} value={addKey} onChange={e => setAddKey(e.target.value)} placeholder="sk-..." className="w-full rounded-md border bg-background px-3 py-2 text-sm pr-10" />
                  <button type="button" onClick={() => setVisibleKeys(prev => { const n = new Set(prev); n.has('new') ? n.delete('new') : n.add('new'); return n; })} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{visibleKeys.has('new') ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
              </div>
              {addSlug && getProviderModels(addSlug).length > 0 && (<div><label className="text-xs font-medium text-muted-foreground">Default Model (optional)</label><select value={addModel} onChange={e => setAddModel(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"><option value="">Use provider default</option>{getProviderModels(addSlug).map(m => <option key={m} value={m}>{m}</option>)}</select></div>)}
              <div className="flex gap-2 justify-end pt-2 border-t">
                <button onClick={() => { setShowAdd(false); setAddSlug(''); setAddKey(''); setAddModel(''); }} className="px-4 py-2 text-sm rounded-md border hover:bg-muted transition-colors">Cancel</button>
                <button onClick={handleAdd} disabled={!addSlug || !addKey || addSubmitting} className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">{addSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /><span>Saving...</span></> : <><Key className="h-4 w-4" /><span>Add Provider</span></>}</button>
              </div>
            </div>
          )}
        </div>

        {/* Institutional / Server Providers */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Institutional Providers</h2>
          <div className="rounded-lg border divide-y">
            {serverProviderSlugs.length === 0 ? (
              <div className="px-4 py-4 flex gap-3 items-start">
                <Server className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">No institutional providers configured. Add API keys to <code className="font-mono text-xs">openmaic.env</code> and restart to enable shared access.</p>
              </div>
            ) : (
              serverProviderSlugs.map(slug => (
                <div key={slug} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center"><Server className="h-4 w-4 text-muted-foreground" /></div>
                    <div>
                      <p className="text-sm font-medium">{getProviderName(slug)}</p>
                      <p className="text-xs text-muted-foreground">{serverProviders[slug].models?.slice(0, 3).join(', ') || 'Available to eligible users'}</p>
                    </div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">Active</span>
                </div>
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground">Institutional keys are set in <code className="font-mono">openmaic.env</code> and shared with all eligible users. To revoke institutional access, remove the key from the env file and restart the service. Your personal keys above take precedence over institutional keys for your account only.</p>
        </div>

        {/* Delete modal */}
        {deleteSlug && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="rounded-lg border bg-card p-6 max-w-sm w-full mx-4 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center"><AlertTriangle className="h-5 w-5 text-destructive" /></div>
                <div><h3 className="font-medium">Remove Personal Key</h3><p className="text-sm text-muted-foreground">{getProviderName(deleteSlug)}</p></div>
              </div>
              <p className="text-sm text-muted-foreground mb-3">This removes <strong>your personal API key</strong>. Your usage will revert to the institutional key if one is active.</p>
              {serverProviders[deleteSlug] ? (
                <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 mb-4 flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 dark:text-amber-300">An institutional {getProviderName(deleteSlug)} key is active. You and all other eligible users will continue to have access through it. To fully revoke access, remove the key from <code className="font-mono">openmaic.env</code> and restart.</p>
                </div>
              ) : (
                <div className="rounded-md border border-muted p-3 mb-4">
                  <p className="text-xs text-muted-foreground">No institutional key is configured for this provider — removing your key will leave you without {getProviderName(deleteSlug)} access.</p>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteSlug(null)} className="px-3 py-1.5 text-sm rounded-md border hover:bg-muted transition-colors">Cancel</button>
                <button onClick={() => handleDelete(deleteSlug)} disabled={deleteSubmitting} className="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50">{deleteSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Remove My Key'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
