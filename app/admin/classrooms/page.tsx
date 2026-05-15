'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Clock, Users, X, Check, UserCircle } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

type Visibility = 'public' | 'enrolled' | 'private' | 'pending';

interface ClassroomSummary {
  id: string;
  name: string;
  ownerId: string | null;
  ownerName: string;
  ownerRole: string;
  visibility: Visibility;
  enrolledCount: number;
  createdAt: string;
  pendingSince: string | null;
}

interface ClassroomDetail extends ClassroomSummary {
  enrolledUserIds: string[];
}

interface AuditEntry {
  id: number;
  changedBy: string;
  changedByName: string | null;
  changedAt: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
}

interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface Stats {
  total: number;
  public: number;
  enrolled: number;
  private: number;
  pending: number;
}

const VISIBILITY_META: Record<Visibility, { label: string; badge: string }> = {
  public:   { label: 'Public',         badge: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  enrolled: { label: 'Enrolled only',  badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  private:  { label: 'Private',        badge: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400' },
  pending:  { label: 'Pending review', badge: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
};

function VisibilityBadge({ v }: { v: Visibility }) {
  const m = VISIBILITY_META[v] ?? VISIBILITY_META.enrolled;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${m.badge}`}>
      {m.label}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function describeEntry(entry: AuditEntry): string {
  if (entry.action === 'visibility_change') {
    try {
      const from = JSON.parse(entry.oldValue ?? '""');
      const to   = JSON.parse(entry.newValue ?? '""');
      return `Visibility changed: ${from} → ${to}`;
    } catch { return 'Visibility changed'; }
  }
  if (entry.action === 'enrollment_change') {
    try {
      const info = JSON.parse(entry.oldValue ?? '{}') as { added?: string[]; removed?: string[] };
      const parts: string[] = [];
      if (info.added?.length)   parts.push(`+${info.added.length} added`);
      if (info.removed?.length) parts.push(`−${info.removed.length} removed`);
      return `Enrollment updated${parts.length ? ': ' + parts.join(', ') : ''}`;
    } catch { return 'Enrollment updated'; }
  }
  if (entry.action === 'metadata_edit') return 'Metadata edited';
  return entry.action;
}

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------

interface EditModalProps {
  classroomId: string;
  onClose: () => void;
  onSaved: (id: string, visibility: Visibility, enrolledUserIds: string[]) => void;
}

function EditModal({ classroomId, onClose, onSaved }: EditModalProps) {
  const [tab, setTab]               = useState<'details' | 'history'>('details');
  const [detail, setDetail]         = useState<ClassroomDetail | null>(null);
  const [history, setHistory]       = useState<AuditEntry[]>([]);
  const [userMap, setUserMap]       = useState<Map<string, UserInfo>>(new Map());
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingUsers, setLoadingUsers]   = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const [newVisibility, setNewVisibility]   = useState<Visibility>('enrolled');
  const [reason, setReason]                 = useState('');
  const [enrolledUserIds, setEnrolledUserIds] = useState<string[]>([]);

  // Fetch classroom detail
  useEffect(() => {
    fetch(`/api/admin/classroom/${classroomId}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setDetail(data as ClassroomDetail);
          setNewVisibility(data.visibility);
          setEnrolledUserIds(data.enrolledUserIds || []);
        } else {
          setError(data.error || 'Failed to load classroom');
        }
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoadingDetail(false));
  }, [classroomId]);

  // Fetch user directory for enrolled user resolution
  useEffect(() => {
    fetch('/api/admin/users')
      .then(r => r.json())
      .then(data => {
        if (data.users) {
          const map = new Map<string, UserInfo>();
          for (const u of data.users as UserInfo[]) {
            map.set(u.id, u);
          }
          setUserMap(map);
        }
      })
      .catch(() => {
        // Silently fail — we'll fall back to showing UUIDs
      })
      .finally(() => setLoadingUsers(false));
  }, []);

  const loadHistory = useCallback(() => {
    setLoadingHistory(true);
    fetch(`/api/admin/classroom/${classroomId}/history`)
      .then(r => r.json())
      .then(data => { if (data.success) setHistory(data.history || []); })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [classroomId]);

  useEffect(() => {
    if (tab === 'history' && history.length === 0) loadHistory();
  }, [tab, history.length, loadHistory]);

  const hasChanges = detail
    ? newVisibility !== detail.visibility ||
      JSON.stringify([...enrolledUserIds].sort()) !== JSON.stringify([...(detail.enrolledUserIds || [])].sort())
    : false;

  const handleSave = async () => {
    if (!detail || !hasChanges) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { reason: reason.trim() || null };
      if (newVisibility !== detail.visibility) body.visibility = newVisibility;
      if (
        JSON.stringify([...enrolledUserIds].sort()) !==
        JSON.stringify([...(detail.enrolledUserIds || [])].sort())
      ) body.enrolledUserIds = enrolledUserIds;

      const res = await fetch(`/api/admin/classroom/${classroomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Save failed'); return; }
      onSaved(classroomId, data.visibility, data.enrolledUserIds || []);
      onClose();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const removeUser = (uid: string) => setEnrolledUserIds(prev => prev.filter(u => u !== uid));

  // Resolve a user ID to a display name + email
  const resolveUser = (uid: string): { displayName: string; displayEmail: string } => {
    const user = userMap.get(uid);
    if (user) {
      return { displayName: user.name || 'Unknown', displayEmail: user.email };
    }
    return { displayName: uid.slice(0, 8) + '…', displayEmail: '' };
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {loadingDetail ? 'Loading…' : (detail?.name || classroomId)}
            </h2>
            {detail && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {detail.ownerName} · {detail.ownerRole} · {enrolledUserIds.length} enrolled
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(['details', 'history'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {tab === 'details' && (
            <div className="space-y-5">
              {loadingDetail ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-8 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
                  ))}
                </div>
              ) : (
                <>
                  {/* Visibility */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                      Visibility
                    </label>
                    <select
                      value={newVisibility}
                      onChange={e => setNewVisibility(e.target.value as Visibility)}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
                    >
                      <option value="public">Public — discoverable in catalog</option>
                      <option value="enrolled">Enrolled only — invite or code required</option>
                      <option value="private">Private — owner and admin only</option>
                      <option value="pending">Pending review</option>
                    </select>
                  </div>

                  {/* Reason */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                      Reason{' '}
                      <span className="text-gray-400 dark:text-gray-500">(recorded in audit log)</span>
                    </label>
                    <textarea
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="Briefly describe why this change is being made…"
                      rows={2}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200 px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-gray-400"
                    />
                  </div>

                  {/* Enrolled users */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                      Enrolled users ({enrolledUserIds.length})
                    </label>
                    {enrolledUserIds.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic">No enrolled users.</p>
                    ) : loadingUsers ? (
                      <div className="space-y-2">
                        {enrolledUserIds.slice(0, 3).map(uid => (
                          <div key={uid} className="h-7 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 max-h-44 overflow-y-auto">
                        {enrolledUserIds.map(uid => {
                          const { displayName, displayEmail } = resolveUser(uid);
                          return (
                            <div key={uid} className="flex items-center justify-between px-3 py-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <UserCircle className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{displayName}</p>
                                  {displayEmail && (
                                    <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{displayEmail}</p>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => removeUser(uid)}
                                className="ml-2 shrink-0 text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors"
                              >
                                Remove
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div>
              {loadingHistory ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-14 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8 italic">
                  No changes recorded yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {history.map(entry => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-gray-100 dark:border-gray-700 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {describeEntry(entry)}
                          </p>
                          {entry.reason && (
                            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 italic">
                              &ldquo;{entry.reason}&rdquo;
                            </p>
                          )}
                          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                            by {entry.changedByName || entry.changedBy}
                          </p>
                        </div>
                        <div className="shrink-0 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                          <Clock className="w-3 h-3" />
                          <span>{formatDateTime(entry.changedAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {tab === 'details' && (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            <a
              href={`/classroom/${classroomId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              Preview classroom
            </a>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors dark:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges || loadingDetail}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                {saving
                  ? 'Saving…'
                  : (<><Check className="w-3.5 h-3.5" />Save changes</>)
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type FilterType = 'all' | Visibility;

export default function AdminClassroomsPage() {
  const router = useRouter();
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [stats, setStats]           = useState<Stats | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [filter, setFilter]         = useState<FilterType>('all');
  const [editingId, setEditingId]   = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/classrooms')
      .then(r => {
        if (r.status === 401 || r.status === 403) { router.push('/admin'); throw new Error('Unauthorized'); }
        return r.json();
      })
      .then(data => {
        if (data.success) {
          setClassrooms(data.classrooms || []);
          setStats(data.stats || null);
        } else {
          setError(data.error || 'Failed to load classrooms');
        }
      })
      .catch(err => { if (err.message !== 'Unauthorized') setError('Unable to load classrooms.'); })
      .finally(() => setLoading(false));
  }, [router]);

  const handleSaved = (id: string, visibility: Visibility, enrolledUserIds: string[]) => {
    setClassrooms(prev => {
      const updated = prev.map(c =>
        c.id === id ? { ...c, visibility, enrolledCount: enrolledUserIds.length } : c,
      );
      setStats({
        total:    updated.length,
        public:   updated.filter(c => c.visibility === 'public').length,
        enrolled: updated.filter(c => c.visibility === 'enrolled').length,
        private:  updated.filter(c => c.visibility === 'private').length,
        pending:  updated.filter(c => c.visibility === 'pending').length,
      });
      return updated;
    });
  };

  const filtered = filter === 'all' ? classrooms : classrooms.filter(c => c.visibility === filter);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <p className="text-gray-500 dark:text-gray-400">Loading classrooms…</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/admin')}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Classroom Governance</h1>
          </div>
          <ThemeToggle />
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="mb-5 grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { key: 'total',    label: 'Total',         value: stats.total,    color: 'bg-white dark:bg-gray-800' },
              { key: 'public',   label: 'Public',        value: stats.public,   color: 'bg-green-50 dark:bg-green-900/20' },
              { key: 'enrolled', label: 'Enrolled only', value: stats.enrolled, color: 'bg-blue-50 dark:bg-blue-900/20' },
              { key: 'private',  label: 'Private',       value: stats.private,  color: 'bg-gray-50 dark:bg-gray-700/30' },
              { key: 'pending',  label: 'Pending',       value: stats.pending,  color: 'bg-amber-50 dark:bg-amber-900/20' },
            ].map(s => (
              <div
                key={s.key}
                className={`rounded-lg border border-gray-200 dark:border-gray-700 ${s.color} px-4 py-3`}
              >
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{s.value}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Filter tabs */}
        <div className="mb-4 flex flex-wrap gap-2">
          {(['all', 'public', 'enrolled', 'private', 'pending'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {f === 'all'
                ? `All (${classrooms.length})`
                : `${VISIBILITY_META[f].label} (${classrooms.filter(c => c.visibility === f).length})`
              }
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">
              No classrooms{filter !== 'all' ? ` with visibility "${filter}"` : ''}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Classroom</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Owner</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Visibility</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />Enrolled</span>
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Created</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-gray-900 dark:text-gray-100 max-w-xs truncate">{c.name}</div>
                        <div className="text-[11px] text-gray-400 dark:text-gray-500 font-mono">{c.id}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="text-gray-700 dark:text-gray-300">{c.ownerName}</div>
                        <div className="text-[11px] text-gray-400 dark:text-gray-500 capitalize">{c.ownerRole}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <VisibilityBadge v={c.visibility} />
                        {c.visibility === 'pending' && c.pendingSince && (
                          <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                            since {formatDate(c.pendingSince)}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-gray-600 dark:text-gray-400">{c.enrolledCount}</td>
                      <td className="px-5 py-3.5 text-gray-500 dark:text-gray-400 text-xs">{formatDate(c.createdAt)}</td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => setEditingId(c.id)}
                          className="rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editingId && (
        <EditModal
          classroomId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
