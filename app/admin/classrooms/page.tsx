'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Clock, Users, X, Check } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

type Visibility    = 'public' | 'enrolled' | 'private' | 'pending';
type LifecycleState = 'active' | 'sunsetting' | 'archived';

interface ClassroomSummary {
  id: string;
  name: string;
  ownerId: string | null;
  ownerName: string;
  ownerRole: string;
  visibility: Visibility;
  lifecycleState: LifecycleState;
  enrolledCount: number;
  createdAt: string;
  pendingSince: string | null;
  archivedAt: string | null;
  sunsettingAt: string | null;
  clonedFromId: string | null;
  cloneGeneration: number;
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

interface Stats {
  total: number; public: number; enrolled: number; private: number; pending: number;
  active: number; sunsetting: number; archived: number;
}

const VIS_META: Record<Visibility, { label: string; badge: string }> = {
  public:   { label: 'Public',         badge: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  enrolled: { label: 'Enrolled only',  badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  private:  { label: 'Private',        badge: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400' },
  pending:  { label: 'Pending review', badge: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
};

const LC_META: Record<LifecycleState, { label: string; badge: string }> = {
  active:     { label: 'Active',     badge: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  sunsetting: { label: 'Sunsetting', badge: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
  archived:   { label: 'Archived',   badge: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500' },
};

const fmt  = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const fmtDT = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}

function describeEntry(e: AuditEntry): string {
  if (e.action === 'visibility_change') {
    try { const f = JSON.parse(e.oldValue ?? '""'); const t = JSON.parse(e.newValue ?? '""'); return `Visibility: ${f} → ${t}`; } catch { return 'Visibility changed'; }
  }
  if (e.action === 'enrollment_change') {
    try { const i = JSON.parse(e.oldValue ?? '{}') as { added?: string[]; removed?: string[] }; const p: string[] = []; if (i.added?.length) p.push(`+${i.added.length}`); if (i.removed?.length) p.push(`−${i.removed.length}`); return `Enrollment updated${p.length ? ': ' + p.join(', ') : ''}`; } catch { return 'Enrollment updated'; }
  }
  if (e.field === 'deleted') return 'Classroom deleted';
  if (e.field === 'lifecycleState') {
    try { return `Lifecycle: ${JSON.parse(e.oldValue ?? '""')} → ${JSON.parse(e.newValue ?? '""')}`; } catch { return 'Lifecycle changed'; }
  }
  if (e.field === 'clonedFromId') return 'Cloned from ' + (JSON.parse(e.newValue ?? '"?"'));
  if (e.field === 'reset') {
    try { const t = (JSON.parse(e.oldValue ?? '{}') as { targets?: string[] }).targets; return `Reset: ${(t || []).join(', ')}`; } catch { return 'Reset'; }
  }
  return e.action.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Shared Modal shell
// ---------------------------------------------------------------------------
function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Modal (visibility + enrollment + history)
// ---------------------------------------------------------------------------
function EditModal({ classroomId, onClose, onSaved }: { classroomId: string; onClose: () => void; onSaved: (id: string, v: Visibility, ids: string[]) => void }) {
  const [tab, setTab] = useState<'details' | 'history'>('details');
  const [detail, setDetail] = useState<ClassroomDetail | null>(null);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newVis, setNewVis] = useState<Visibility>('enrolled');
  const [reason, setReason] = useState('');
  const [enrolledIds, setEnrolledIds] = useState<string[]>([]);

  useEffect(() => {
    fetch(`/api/admin/classroom/${classroomId}`).then(r => r.json()).then(d => {
      if (d.success) { setDetail(d as ClassroomDetail); setNewVis(d.visibility); setEnrolledIds(d.enrolledUserIds || []); }
      else setError(d.error || 'Failed to load');
    }).catch(() => setError('Network error')).finally(() => setLoadingDetail(false));
  }, [classroomId]);

  const loadHistory = useCallback(() => {
    setLoadingHistory(true);
    fetch(`/api/admin/classroom/${classroomId}/history`).then(r => r.json()).then(d => { if (d.success) setHistory(d.history || []); }).catch(() => {}).finally(() => setLoadingHistory(false));
  }, [classroomId]);

  useEffect(() => { if (tab === 'history' && history.length === 0) loadHistory(); }, [tab, history.length, loadHistory]);

  const hasChanges = detail
    ? newVis !== detail.visibility || JSON.stringify([...enrolledIds].sort()) !== JSON.stringify([...(detail.enrolledUserIds || [])].sort())
    : false;

  const save = async () => {
    if (!detail || !hasChanges) return;
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = { reason: reason.trim() || null };
      if (newVis !== detail.visibility) body.visibility = newVis;
      if (JSON.stringify([...enrolledIds].sort()) !== JSON.stringify([...(detail.enrolledUserIds || [])].sort())) body.enrolledUserIds = enrolledIds;
      const res = await fetch(`/api/admin/classroom/${classroomId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Save failed'); return; }
      onSaved(classroomId, d.visibility, d.enrolledUserIds || []);
      onClose();
    } catch { setError('Network error.'); } finally { setSaving(false); }
  };

  return (
    <Modal title={loadingDetail ? 'Loading…' : (detail?.name || classroomId)} subtitle={detail ? `${detail.ownerName} · ${detail.ownerRole} · ${enrolledIds.length} enrolled` : undefined} onClose={onClose}>
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {(['details', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-5 py-2.5 text-sm font-medium capitalize transition-colors ${tab === t ? 'border-b-2 border-primary text-primary' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>{t}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {error && <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">{error}</div>}
        {tab === 'details' && (
          <div className="space-y-5">
            {loadingDetail ? [1,2,3].map(i => <div key={i} className="h-8 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Visibility</label>
                  <select value={newVis} onChange={e => setNewVis(e.target.value as Visibility)} className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-primary">
                    <option value="public">Public — discoverable in catalog</option>
                    <option value="enrolled">Enrolled only — invite or code required</option>
                    <option value="private">Private — owner and admin only</option>
                    <option value="pending">Pending review</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Reason <span className="text-gray-400">(audit log)</span></label>
                  <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Briefly describe why…" rows={2} className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200 px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary placeholder:text-gray-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Enrolled users ({enrolledIds.length})</label>
                  {enrolledIds.length === 0 ? <p className="text-xs text-gray-400 italic">No enrolled users.</p> : (
                    <div className="rounded-lg border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 max-h-44 overflow-y-auto">
                      {enrolledIds.map(uid => (
                        <div key={uid} className="flex items-center justify-between px-3 py-1.5">
                          <span className="text-xs text-gray-600 dark:text-gray-400 font-mono truncate">{uid}</span>
                          <button onClick={() => setEnrolledIds(p => p.filter(u => u !== uid))} className="ml-2 shrink-0 text-xs text-red-500 hover:text-red-700">Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        {tab === 'history' && (
          <div>
            {loadingHistory ? [1,2,3].map(i => <div key={i} className="mb-3 h-14 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />) :
              history.length === 0 ? <p className="text-sm text-gray-400 text-center py-8 italic">No changes recorded yet.</p> : (
                <div className="space-y-3">
                  {history.map(e => (
                    <div key={e.id} className="rounded-lg border border-gray-100 dark:border-gray-700 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{describeEntry(e)}</p>
                          {e.reason && <p className="mt-0.5 text-xs text-gray-500 italic">&ldquo;{e.reason}&rdquo;</p>}
                          <p className="mt-1 text-xs text-gray-400">by {e.changedByName || e.changedBy}</p>
                        </div>
                        <div className="shrink-0 flex items-center gap-1 text-xs text-gray-400"><Clock className="w-3 h-3" />{fmtDT(e.changedAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        )}
      </div>
      {tab === 'details' && (
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <a href={`/classroom/${classroomId}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"><ExternalLink className="w-3 h-3" />Preview</a>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">Cancel</button>
            <button onClick={save} disabled={saving || !hasChanges || loadingDetail} className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
              {saving ? 'Saving…' : <><Check className="w-3.5 h-3.5" />Save</>}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Archive Modal
// ---------------------------------------------------------------------------
function ArchiveModal({ classroom, onClose, onSaved }: { classroom: ClassroomSummary; onClose: () => void; onSaved: (id: string, state: LifecycleState) => void }) {
  const [mode, setMode] = useState<'archive' | 'sunset'>('archive');
  const [sunsettingAt, setSunsettingAt] = useState('');
  const [sunsettingMessage, setSunsettingMessage] = useState('');
  const [successorId, setSuccessorId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = { reason: reason.trim() || null };
      if (mode === 'sunset') { body.sunsetting = true; body.sunsettingAt = sunsettingAt || null; body.sunsettingMessage = sunsettingMessage.trim() || null; body.successorId = successorId.trim() || null; }
      const res = await fetch(`/api/classroom/${classroom.id}/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed'); return; }
      onSaved(classroom.id, d.lifecycleState);
      onClose();
    } catch { setError('Network error.'); } finally { setSaving(false); }
  };

  return (
    <Modal title="Archive Classroom" subtitle={classroom.name} onClose={onClose}>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">{error}</div>}
        <div className="flex gap-3">
          {(['archive', 'sunset'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${mode === m ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
              {m === 'archive' ? 'Archive now' : 'Set sunset date'}
            </button>
          ))}
        </div>
        {mode === 'sunset' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Closing date</label>
              <input type="date" value={sunsettingAt} onChange={e => setSunsettingAt(e.target.value)} className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Message to students <span className="text-gray-400">(optional)</span></label>
              <textarea value={sunsettingMessage} onChange={e => setSunsettingMessage(e.target.value)} placeholder="This classroom is concluding. Thank you for participating." rows={2} className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200 px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary placeholder:text-gray-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Successor classroom ID <span className="text-gray-400">(optional — shown as ‘Join next cohort’ link)</span></label>
              <input value={successorId} onChange={e => setSuccessorId(e.target.value)} placeholder="e.g. intro-ml-fall-2026" className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-primary" />
            </div>
          </>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Reason <span className="text-gray-400">(audit log)</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Briefly describe why…" rows={2} className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200 px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary placeholder:text-gray-400" />
        </div>
        {mode === 'archive' && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-400">
            Enrolled students will retain read-only access. No new enrollments will be accepted.
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
          {saving ? 'Saving…' : mode === 'archive' ? 'Archive' : 'Set Sunset Date'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reset Modal
// ---------------------------------------------------------------------------
function ResetModal({ classroom, onClose, onSaved }: { classroom: ClassroomSummary; onClose: () => void; onSaved: (id: string) => void }) {
  const [targets, setTargets] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (t: string) => setTargets(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);

  const submit = async () => {
    if (targets.length === 0) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/classroom/${classroom.id}/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targets, reason: reason.trim() || null }) });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed'); return; }
      onSaved(classroom.id);
      onClose();
    } catch { setError('Network error.'); } finally { setSaving(false); }
  };

  const TARGETS = [
    { id: 'enrollments',    label: 'Clear enrollments',   desc: 'enrolledUserIds → []' },
    { id: 'pendingState',   label: 'Reset pending state', desc: 'visibility → enrolled, clear pendingSince' },
    { id: 'lifecycleState', label: 'Restore lifecycle',   desc: 'lifecycleState → active, clear archive/sunset dates' },
  ];

  return (
    <Modal title="Reset Classroom" subtitle={classroom.name} onClose={onClose}>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">{error}</div>}
        <p className="text-sm text-gray-600 dark:text-gray-400">Select what to clear. Stage and scenes are never modified.</p>
        {TARGETS.map(t => (
          <label key={t.id} className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={targets.includes(t.id)} onChange={() => toggle(t.id)} className="mt-0.5 rounded border-gray-300" />
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{t.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t.desc}</p>
            </div>
          </label>
        ))}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Reason <span className="text-gray-400">(audit log)</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Briefly describe why…" rows={2} className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200 px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary placeholder:text-gray-400" />
        </div>
      </div>
      <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving || targets.length === 0} className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? 'Resetting…' : 'Reset'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Delete Modal
// ---------------------------------------------------------------------------
function DeleteModal({ classroom, onClose, onDeleted }: { classroom: ClassroomSummary; onClose: () => void; onDeleted: (id: string) => void }) {
  const [confirmName, setConfirmName] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameMatches = confirmName === classroom.name;
  const notArchived = classroom.lifecycleState !== 'archived';

  const submit = async () => {
    if (!nameMatches) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/classroom/${classroom.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmName, reason: reason.trim() || null }) });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed'); return; }
      onDeleted(classroom.id);
      onClose();
    } catch { setError('Network error.'); } finally { setSaving(false); }
  };

  return (
    <Modal title="Delete Classroom" subtitle={classroom.name} onClose={onClose}>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">{error}</div>}
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 space-y-2 text-sm">
          <p className="font-semibold text-red-700 dark:text-red-400">This cannot be undone.</p>
          <p className="text-red-600 dark:text-red-400">{classroom.enrolledCount} enrolled user{classroom.enrolledCount === 1 ? '' : 's'} will lose access.</p>
          {notArchived && <p className="text-red-600 dark:text-red-400">Tip: Archive this classroom first to preserve enrolled access during the transition.</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            Type <strong className="text-gray-800 dark:text-gray-200">{classroom.name}</strong> to confirm
          </label>
          <input value={confirmName} onChange={e => setConfirmName(e.target.value)} placeholder={classroom.name} className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-red-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Reason <span className="text-gray-400">(audit log)</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Briefly describe why…" rows={2} className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-200 px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary placeholder:text-gray-400" />
        </div>
      </div>
      <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving || !nameMatches} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
          {saving ? 'Deleting…' : 'Delete permanently'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
type VisFilter = 'all' | Visibility;
type LCFilter  = 'all' | LifecycleState;

export default function AdminClassroomsPage() {
  const router = useRouter();
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [stats, setStats]           = useState<Stats | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [visFilter, setVisFilter]   = useState<VisFilter>('all');
  const [lcFilter, setLcFilter]     = useState<LCFilter>('all');
  const [cloneResult, setCloneResult] = useState<{ id: string; name: string } | null>(null);

  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [archivingId,  setArchivingId]  = useState<string | null>(null);
  const [resettingId,  setResettingId]  = useState<string | null>(null);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const [cloningId,    setCloningId]    = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/classrooms')
      .then(r => { if (r.status === 401 || r.status === 403) { router.push('/admin'); throw new Error('Unauthorized'); } return r.json(); })
      .then(d => { if (d.success) { setClassrooms(d.classrooms || []); setStats(d.stats || null); } else setError(d.error || 'Failed to load'); })
      .catch(e => { if (e.message !== 'Unauthorized') setError('Unable to load classrooms.'); })
      .finally(() => setLoading(false));
  }, [router]);

  const handleSaved = (id: string, visibility: Visibility, ids: string[]) => {
    setClassrooms(prev => { const u = prev.map(c => c.id === id ? { ...c, visibility, enrolledCount: ids.length } : c); rebuildStats(u); return u; });
  };
  const handleArchived = (id: string, state: LifecycleState) => {
    setClassrooms(prev => { const u = prev.map(c => c.id === id ? { ...c, lifecycleState: state } : c); rebuildStats(u); return u; });
  };
  const handleReset = (id: string) => {
    setClassrooms(prev => { const u = prev.map(c => c.id === id ? { ...c, lifecycleState: 'active' as LifecycleState, enrolledCount: 0 } : c); rebuildStats(u); return u; });
  };
  const handleDeleted = (id: string) => {
    setClassrooms(prev => { const u = prev.filter(c => c.id !== id); rebuildStats(u); return u; });
  };
  const rebuildStats = (list: ClassroomSummary[]) => {
    setStats({ total: list.length, public: list.filter(c => c.visibility === 'public').length, enrolled: list.filter(c => c.visibility === 'enrolled').length, private: list.filter(c => c.visibility === 'private').length, pending: list.filter(c => c.visibility === 'pending').length, active: list.filter(c => c.lifecycleState === 'active').length, sunsetting: list.filter(c => c.lifecycleState === 'sunsetting').length, archived: list.filter(c => c.lifecycleState === 'archived').length });
  };

  const handleClone = async (classroom: ClassroomSummary) => {
    setCloningId(classroom.id);
    try {
      const res = await fetch(`/api/classroom/${classroom.id}/clone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Clone failed'); return; }
      setCloneResult({ id: d.id, name: d.name });
    } catch { setError('Clone failed.'); } finally { setCloningId(null); }
  };

  const filtered = classrooms
    .filter(c => visFilter === 'all' || c.visibility === visFilter)
    .filter(c => lcFilter  === 'all' || c.lifecycleState === lcFilter);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <p className="text-gray-500 dark:text-gray-400">Loading classrooms…</p>
    </div>
  );

  const archivingClassroom = archivingId ? classrooms.find(c => c.id === archivingId) : null;
  const resettingClassroom = resettingId ? classrooms.find(c => c.id === resettingId) : null;
  const deletingClassroom  = deletingId  ? classrooms.find(c => c.id === deletingId)  : null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/admin')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><ArrowLeft className="w-4 h-4" /></button>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Classroom Governance</h1>
          </div>
          <ThemeToggle />
        </div>

        {/* Clone result banner */}
        {cloneResult && (
          <div className="mb-4 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-700 dark:text-green-300 flex items-center justify-between">
            <span>Cloned! <strong>{cloneResult.name}</strong> created as private. <a href={`/classroom/${cloneResult.id}`} target="_blank" rel="noopener noreferrer" className="underline">Open →</a></span>
            <button onClick={() => setCloneResult(null)} className="ml-4 text-green-500">&times;</button>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="mb-5 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {[
              { k: 'total',      l: 'Total',         v: stats.total,      c: 'bg-white dark:bg-gray-800' },
              { k: 'public',     l: 'Public',        v: stats.public,     c: 'bg-green-50 dark:bg-green-900/20' },
              { k: 'enrolled',   l: 'Enrolled',      v: stats.enrolled,   c: 'bg-blue-50 dark:bg-blue-900/20' },
              { k: 'private',    l: 'Private',       v: stats.private,    c: 'bg-gray-50 dark:bg-gray-700/30' },
              { k: 'pending',    l: 'Pending',       v: stats.pending,    c: 'bg-amber-50 dark:bg-amber-900/20' },
              { k: 'active',     l: 'Active',        v: stats.active,     c: 'bg-white dark:bg-gray-800' },
              { k: 'sunsetting', l: 'Sunsetting',    v: stats.sunsetting, c: 'bg-amber-50 dark:bg-amber-900/20' },
              { k: 'archived',   l: 'Archived',      v: stats.archived,   c: 'bg-gray-50 dark:bg-gray-700/30' },
            ].map(s => (
              <div key={s.k} className={`rounded-lg border border-gray-200 dark:border-gray-700 ${s.c} px-3 py-2`}>
                <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{s.v}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">{s.l}</div>
              </div>
            ))}
          </div>
        )}

        {error && <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">{error}</div>}

        {/* Filters */}
        <div className="mb-3 flex flex-wrap gap-2">
          {(['all', 'public', 'enrolled', 'private', 'pending'] as const).map(f => (
            <button key={f} onClick={() => setVisFilter(f)} className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${visFilter === f ? 'bg-primary text-primary-foreground' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}>
              {f === 'all' ? `All (${classrooms.length})` : `${VIS_META[f as Visibility]?.label} (${classrooms.filter(c => c.visibility === f).length})`}
            </button>
          ))}
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {(['all', 'active', 'sunsetting', 'archived'] as const).map(f => (
            <button key={f} onClick={() => setLcFilter(f)} className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${lcFilter === f ? 'bg-gray-700 dark:bg-gray-200 text-white dark:text-gray-900' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}>
              {f === 'all' ? 'Any lifecycle' : `${LC_META[f as LifecycleState]?.label} (${classrooms.filter(c => c.lifecycleState === f).length})`}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">No classrooms match the current filter.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Classroom</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Owner</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Visibility</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Lifecycle</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"><span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />Enrolled</span></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Created</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-gray-100 max-w-[200px] truncate">{c.name}</div>
                        <div className="text-[11px] text-gray-400 font-mono">{c.id}</div>
                        {c.clonedFromId && <div className="text-[11px] text-gray-400">v{c.cloneGeneration} — cloned</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-700 dark:text-gray-300 max-w-[120px] truncate">{c.ownerName}</div>
                        <div className="text-[11px] text-gray-400 capitalize">{c.ownerRole}</div>
                      </td>
                      <td className="px-4 py-3"><Badge label={VIS_META[c.visibility]?.label ?? c.visibility} cls={VIS_META[c.visibility]?.badge ?? ''} /></td>
                      <td className="px-4 py-3">
                        <Badge label={LC_META[c.lifecycleState]?.label ?? c.lifecycleState} cls={LC_META[c.lifecycleState]?.badge ?? ''} />
                        {c.lifecycleState === 'sunsetting' && c.sunsettingAt && <div className="text-[11px] text-amber-600 mt-0.5">{fmt(c.sunsettingAt)}</div>}
                        {c.lifecycleState === 'archived'   && c.archivedAt   && <div className="text-[11px] text-gray-400 mt-0.5">{fmt(c.archivedAt)}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.enrolledCount}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{fmt(c.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <button onClick={() => setEditingId(c.id)}   className="text-blue-600 dark:text-blue-400 hover:underline">Edit</button>
                          <button onClick={() => setArchivingId(c.id)} className="text-amber-600 dark:text-amber-400 hover:underline">Archive</button>
                          <button onClick={() => handleClone(c)} disabled={cloningId === c.id} className="text-green-600 dark:text-green-400 hover:underline disabled:opacity-50">{cloningId === c.id ? '…' : 'Clone'}</button>
                          <button onClick={() => setResettingId(c.id)} className="text-gray-600 dark:text-gray-400 hover:underline">Reset</button>
                          <button onClick={() => setDeletingId(c.id)}  className="text-red-600 dark:text-red-400 hover:underline">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editingId   && <EditModal   classroomId={editingId}   onClose={() => setEditingId(null)}   onSaved={handleSaved} />}
      {archivingClassroom && <ArchiveModal classroom={archivingClassroom} onClose={() => setArchivingId(null)} onSaved={handleArchived} />}
      {resettingClassroom && <ResetModal  classroom={resettingClassroom} onClose={() => setResettingId(null)} onSaved={handleReset}   />}
      {deletingClassroom  && <DeleteModal classroom={deletingClassroom}  onClose={() => setDeletingId(null)}  onDeleted={handleDeleted} />}
    </div>
  );
}
