'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, ArrowLeft, Users, Cpu, Calendar } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

interface UsageLog { id: string; userId: string; providerSlug: string; model: string; inputTokens: number; outputTokens: number; createdAt: string; }
interface UsageAggregate { key: string; totalInputTokens: number; totalOutputTokens: number; totalCalls: number; }
type GroupBy = 'userId' | 'providerSlug' | 'model' | 'day';

export default function UsageDashboardPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [aggregates, setAggregates] = useState<UsageAggregate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'logs' | 'aggregates'>('aggregates');
  const [groupBy, setGroupBy] = useState<GroupBy>('userId');
  const [startDate, setStartDate] = useState<string>();
  const [endDate, setEndDate] = useState<string>();

  useEffect(() => { fetchData(); }, [viewMode, groupBy, startDate, endDate]);

  async function fetchData() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const endpoint = viewMode === 'aggregates'
        ? (params.set('aggregate', 'true'), params.set('groupBy', groupBy), `/api/admin/usage?${params}`)
        : `/api/admin/usage?${params}`;
      const res = await fetch(endpoint);
      if (!res.ok) {
        if (res.status === 401) { router.push('/login?callbackUrl=/admin/usage'); return; }
        if (res.status === 403) { router.push('/dashboard'); return; }
        throw new Error('Failed to fetch');
      }
      const data = await res.json();
      if (viewMode === 'aggregates') setAggregates(data.aggregates || []); else setLogs(data.logs || []);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unknown error'); }
    finally { setLoading(false); }
  }

  function fmt(n: number) { return n >= 1_000_000 ? (n/1_000_000).toFixed(1)+'M' : n >= 1_000 ? (n/1_000).toFixed(1)+'K' : n.toString(); }
  const totalCalls = aggregates.reduce((s, a) => s + a.totalCalls, 0);
  const totalInput = aggregates.reduce((s, a) => s + a.totalInputTokens, 0);
  const totalOutput = aggregates.reduce((s, a) => s + a.totalOutputTokens, 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/admin')} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><ArrowLeft className="w-5 h-5" /></button>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2"><BarChart3 className="w-6 h-6" />Usage Dashboard</h1>
          </div>
          <ThemeToggle />
        </div>
        {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">{error}<button onClick={() => setError(null)} className="ml-2 text-red-500">×</button></div>}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap gap-4 items-end">
          <div className="flex gap-2">
            {(['aggregates', 'logs'] as const).map(m => (<button key={m} onClick={() => setViewMode(m)} className={`px-4 py-2 text-sm rounded-lg font-medium ${viewMode === m ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>{m === 'aggregates' ? 'Aggregates' : 'Raw Logs'}</button>))}
          </div>
          {viewMode === 'aggregates' && (
            <div className="flex gap-2">
              {(['userId', 'providerSlug', 'model', 'day'] as GroupBy[]).map(g => (<button key={g} onClick={() => setGroupBy(g)} className={`px-3 py-1.5 text-xs rounded-md ${groupBy === g ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>By {g === 'userId' ? 'User' : g === 'providerSlug' ? 'Provider' : g === 'model' ? 'Model' : 'Day'}</button>))}
            </div>
          )}
          <div className="flex gap-3 items-end">
            <div><label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Start Date</label><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-200" /></div>
            <div><label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">End Date</label><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-200" /></div>
          </div>
        </div>
        {viewMode === 'aggregates' && !loading && (
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[{icon:<Users className="w-4 h-4"/>,label:'Total Calls',val:totalCalls.toLocaleString()},{icon:<Cpu className="w-4 h-4"/>,label:'Input Tokens',val:fmt(totalInput)},{icon:<Calendar className="w-4 h-4"/>,label:'Output Tokens',val:fmt(totalOutput)}].map(c=>(
              <div key={c.label} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">{c.icon}{c.label}</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{c.val}</div>
              </div>
            ))}
          </div>
        )}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          {loading ? <div className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">Loading...</div>
          : viewMode === 'aggregates' ? (
            <div>
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700"><h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Usage by {groupBy === 'userId' ? 'User' : groupBy === 'providerSlug' ? 'Provider' : groupBy === 'model' ? 'Model' : 'Day'}</h2></div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {aggregates.map((a,i)=>(<div key={i} className="px-6 py-3 flex items-center justify-between"><span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-xs">{a.key}</span><div className="flex items-center gap-6 text-sm text-gray-600 dark:text-gray-400"><span>{a.totalCalls.toLocaleString()} calls</span><span>{fmt(a.totalInputTokens)} in</span><span>{fmt(a.totalOutputTokens)} out</span></div></div>))}
                {aggregates.length === 0 && <div className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">No usage data found.</div>}
              </div>
            </div>
          ) : (
            <div>
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700"><h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Raw Usage Logs</h2></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                    <tr>{['User','Provider','Model','In Tokens','Out Tokens','Time'].map(h=>(<th key={h} className={`px-4 py-2 text-gray-500 dark:text-gray-400 font-medium ${['In Tokens','Out Tokens'].includes(h)?'text-right':'text-left'}`}>{h}</th>))}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {logs.map(log=>(<tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30"><td className="px-4 py-2 text-gray-900 dark:text-gray-200 font-mono text-xs">{log.userId.slice(0,8)}…</td><td className="px-4 py-2 text-gray-600 dark:text-gray-400">{log.providerSlug}</td><td className="px-4 py-2 text-gray-600 dark:text-gray-400">{log.model}</td><td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{log.inputTokens.toLocaleString()}</td><td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{log.outputTokens.toLocaleString()}</td><td className="px-4 py-2 text-gray-400 dark:text-gray-500 text-xs">{new Date(log.createdAt).toLocaleString()}</td></tr>))}
                  </tbody>
                </table>
              </div>
              {logs.length === 0 && <div className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">No usage logs found.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
