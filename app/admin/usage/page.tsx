'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, ArrowLeft, Users, Cpu, Calendar } from 'lucide-react';

interface UsageLog {
  id: string;
  userId: string;
  providerSlug: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

interface UsageAggregate {
  key: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
}

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

  useEffect(() => {
    fetchData();
  }, [viewMode, groupBy, startDate, endDate]);

  async function fetchData() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      if (viewMode === 'aggregates') {
        params.set('aggregate', 'true');
        params.set('groupBy', groupBy);
        const res = await fetch(`/api/admin/usage?${params}`);
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            router.push('/login');
            return;
          }
          throw new Error('Failed to fetch usage data');
        }
        const data = await res.json();
        setAggregates(data.aggregates || []);
      } else {
        const res = await fetch(`/api/admin/usage?${params}`);
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            router.push('/login');
            return;
          }
          throw new Error('Failed to fetch usage logs');
        }
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
  }

  const totalCalls = aggregates.reduce((sum, a) => sum + a.totalCalls, 0);
  const totalInput = aggregates.reduce((sum, a) => sum + a.totalInputTokens, 0);
  const totalOutput = aggregates.reduce((sum, a) => sum + a.totalOutputTokens, 0);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/admin')}
              className="text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-6 h-6" />
              Usage Dashboard
            </h1>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-red-500">×</button>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4 flex flex-wrap gap-4 items-end">
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('aggregates')}
              className={`px-4 py-2 text-sm rounded-lg font-medium ${
                viewMode === 'aggregates' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Aggregates
            </button>
            <button
              onClick={() => setViewMode('logs')}
              className={`px-4 py-2 text-sm rounded-lg font-medium ${
                viewMode === 'logs' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Raw Logs
            </button>
          </div>

          {viewMode === 'aggregates' && (
            <div className="flex gap-2">
              {(['userId', 'providerSlug', 'model', 'day'] as GroupBy[]).map(g => (
                <button
                  key={g}
                  onClick={() => setGroupBy(g)}
                  className={`px-3 py-1.5 text-xs rounded-md ${
                    groupBy === g ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  By {g === 'userId' ? 'User' : g === 'providerSlug' ? 'Provider' : g === 'model' ? 'Model' : 'Day'}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
              />
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        {viewMode === 'aggregates' && !loading && (
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                <Users className="w-4 h-4" /> Total Calls
              </div>
              <div className="text-2xl font-bold text-gray-900">{totalCalls.toLocaleString()}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                <Cpu className="w-4 h-4" /> Input Tokens
              </div>
              <div className="text-2xl font-bold text-gray-900">{formatTokens(totalInput)}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                <Calendar className="w-4 h-4" /> Output Tokens
              </div>
              <div className="text-2xl font-bold text-gray-900">{formatTokens(totalOutput)}</div>
            </div>
          </div>
        )}

        {/* Data Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="px-6 py-12 text-center text-gray-400">Loading...</div>
          ) : viewMode === 'aggregates' ? (
            <div>
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800">
                  Usage by {groupBy === 'userId' ? 'User' : groupBy === 'providerSlug' ? 'Provider' : groupBy === 'model' ? 'Model' : 'Day'}
                </h2>
              </div>
              <div className="divide-y divide-gray-100">
                {aggregates.map((agg, i) => (
                  <div key={i} className="px-6 py-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 truncate max-w-xs">
                      {agg.key}
                    </span>
                    <div className="flex items-center gap-6 text-sm text-gray-600">
                      <span>{agg.totalCalls.toLocaleString()} calls</span>
                      <span>{formatTokens(agg.totalInputTokens)} in</span>
                      <span>{formatTokens(agg.totalOutputTokens)} out</span>
                    </div>
                  </div>
                ))}
                {aggregates.length === 0 && (
                  <div className="px-6 py-12 text-center text-gray-400">No usage data found.</div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800">Raw Usage Logs</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left text-gray-500 font-medium">User</th>
                      <th className="px-4 py-2 text-left text-gray-500 font-medium">Provider</th>
                      <th className="px-4 py-2 text-left text-gray-500 font-medium">Model</th>
                      <th className="px-4 py-2 text-right text-gray-500 font-medium">In Tokens</th>
                      <th className="px-4 py-2 text-right text-gray-500 font-medium">Out Tokens</th>
                      <th className="px-4 py-2 text-left text-gray-500 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {logs.map(log => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-900 font-mono text-xs">{log.userId.slice(0, 8)}…</td>
                        <td className="px-4 py-2 text-gray-600">{log.providerSlug}</td>
                        <td className="px-4 py-2 text-gray-600">{log.model}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{log.inputTokens.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{log.outputTokens.toLocaleString()}</td>
                        <td className="px-4 py-2 text-gray-400 text-xs">{new Date(log.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {logs.length === 0 && (
                <div className="px-6 py-12 text-center text-gray-400">No usage logs found.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
