'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from '@/lib/auth-client';
import { AuthGuard } from '@/components/auth/auth-guard';
import { ThemeToggle } from '@/components/theme-toggle';
import { LogOut, Key } from 'lucide-react';

interface EnrolledClassroom {
  id: string;
  name: string;
  instructor: string;
  visibility: string;
  createdAt: string;
  isOwner: boolean;
  pendingSince: string | null;
  lifecycleState: string;
  sunsettingAt: string | null;
  sunsettingMessage: string | null;
  successorId: string | null;
}

function visibilityBadgeClass(v: string): string {
  switch (v) {
    case 'public':   return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
    case 'pending':  return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
    case 'enrolled': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
    default:         return 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400';
  }
}

function visibilityLabel(v: string): string {
  switch (v) {
    case 'public':   return 'Public';
    case 'pending':  return '⏳ Pending review';
    case 'enrolled': return 'Enrolled only';
    case 'private':  return 'Private';
    default:         return v;
  }
}

function getVisibilityOptions(role: string | undefined, currentVisibility: string) {
  if (role === 'admin' || role === 'instructor') {
    return [
      { value: 'private',  label: 'Private' },
      { value: 'enrolled', label: 'Enrolled only' },
      { value: 'pending',  label: 'Pending review' },
      { value: 'public',   label: 'Public' },
    ];
  }
  if (currentVisibility === 'public') return [];
  return [
    { value: 'private',  label: 'Private' },
    { value: 'enrolled', label: 'Enrolled only' },
    { value: 'pending',  label: 'Submit for review' },
  ];
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-3">
          <div className="h-8 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
              <div className="mb-4 h-5 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardContent() {
  const router = useRouter();
  const { data: session } = useSession();
  const sessionUser = session?.user as { id: string; email: string; name?: string | null; role?: string | null } | undefined;
  const user = sessionUser
    ? { id: sessionUser.id, email: sessionUser.email, name: sessionUser.name || sessionUser.email, role: sessionUser.role || 'student' }
    : null;

  const [classrooms, setClassrooms] = useState<EnrolledClassroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEnrollmentCount, setNewEnrollmentCount] = useState(0);
  const [updatingVisibility, setUpdatingVisibility] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    async function loadClassrooms() {
      try {
        const res = await fetch('/api/user/enrollments');
        if (res.ok) {
          const data = await res.json();
          const fetched: EnrolledClassroom[] = data.classrooms || [];
          setClassrooms(fetched);
          const current = fetched.filter(c => c.lifecycleState !== 'archived').length;
          const lastSeen = parseInt(localStorage.getItem('lastSeenEnrollmentCount') || '0', 10);
          if (current > lastSeen && lastSeen > 0) setNewEnrollmentCount(current - lastSeen);
          localStorage.setItem('lastSeenEnrollmentCount', String(current));
        } else {
          setError('Failed to load classrooms.');
        }
      } catch {
        setError('Unable to connect. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    loadClassrooms();
  }, []);

  const handleSignOut = async () => {
    try { await signOut(); } catch {
      document.cookie = 'better-auth.session_token=; Max-Age=0; path=/';
      document.cookie = '__Secure-better-auth.session_token=; Max-Age=0; path=/; Secure';
      document.cookie = 'better-auth.session_data=; Max-Age=0; path=/';
      document.cookie = '__Secure-better-auth.session_data=; Max-Age=0; path=/; Secure';
    }
    router.push('/login');
  };

  const handleVisibilityChange = async (classroomId: string, newVisibility: string) => {
    setUpdatingVisibility(classroomId);
    setError(null);
    try {
      const res = await fetch(`/api/classroom/${classroomId}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVisibility }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Failed to update visibility.');
        return;
      }
      setClassrooms(prev =>
        prev.map(c =>
          c.id === classroomId
            ? { ...c, visibility: newVisibility, pendingSince: newVisibility === 'pending' ? new Date().toISOString() : null }
            : c
        )
      );
    } catch {
      setError('Unable to update visibility. Please try again.');
    } finally {
      setUpdatingVisibility(null);
    }
  };

  if (loading) return <DashboardSkeleton />;

  const isInstructorOrAdmin = user?.role === 'admin' || user?.role === 'instructor';
  const activeClassrooms   = classrooms.filter(c => c.lifecycleState !== 'archived');
  const archivedClassrooms = classrooms.filter(c => c.lifecycleState === 'archived');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight dark:text-gray-100">
              {user ? `Welcome, ${user.name || user.email}` : 'My Classrooms'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeClassrooms.length === 0
                ? 'You have not joined any classrooms yet.'
                : `You are enrolled in ${activeClassrooms.length} classroom${activeClassrooms.length === 1 ? '' : 's'}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => router.push('/')}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Create Classroom
            </button>
            {user?.role === 'admin' && (
              <button
                onClick={() => router.push('/admin')}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200"
              >
                Admin
              </button>
            )}
            <button onClick={() => router.push('/enroll')} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">Join a Classroom</button>
            <button onClick={() => router.push('/catalog')} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">Browse Classrooms</button>
            <ThemeToggle />
            <button onClick={handleSignOut} className="p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {newEnrollmentCount > 0 && (
          <div className="mb-6 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-700 dark:text-green-300 flex items-center justify-between">
            <span>You have been enrolled in {newEnrollmentCount} new classroom{newEnrollmentCount === 1 ? '' : 's'}.</span>
            <button onClick={() => setNewEnrollmentCount(0)} className="ml-4 text-green-500 hover:text-green-700 font-medium">Dismiss</button>
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">×</button>
          </div>
        )}

        {activeClassrooms.length === 0 && !error && isInstructorOrAdmin && (
          <div className="mb-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Key className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="text-sm text-blue-800 dark:text-blue-300">Configure an AI provider before creating your first classroom.</span>
            </div>
            <button onClick={() => router.push('/settings')} className="shrink-0 ml-4 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors whitespace-nowrap">Configure AI Stack →</button>
          </div>
        )}

        {activeClassrooms.length === 0 && !error && (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-8 text-center shadow-sm sm:p-12">
            <svg className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">No classrooms yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">Ask your instructor for a classroom code, or browse open classrooms to get started.</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button onClick={() => router.push('/enroll')} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Join with Code</button>
              <button onClick={() => router.push('/catalog')} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">Browse Open Classrooms</button>
            </div>
          </div>
        )}

        {activeClassrooms.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {activeClassrooms.map(classroom => {
              const options = classroom.isOwner ? getVisibilityOptions(user?.role, classroom.visibility) : [];
              const isLocked = classroom.isOwner && classroom.visibility === 'public' && user?.role === 'student';
              const isSunsetting = classroom.lifecycleState === 'sunsetting';
              return (
                <div key={classroom.id} className="flex flex-col gap-1.5">
                  <button
                    onClick={() => router.push(`/classroom/${classroom.id}`)}
                    className="group rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-left shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 transition-colors group-hover:text-primary leading-snug">{classroom.name}</h3>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {classroom.isOwner && (
                          <span className="rounded-full bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">Owner</span>
                        )}
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${visibilityBadgeClass(classroom.visibility)}`}>
                          {visibilityLabel(classroom.visibility)}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{classroom.instructor}</p>
                    <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{new Date(classroom.createdAt).toLocaleDateString()}</p>
                  </button>

                  {/* Sunsetting notice */}
                  {isSunsetting && classroom.sunsettingAt && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                      <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                        ⏳ Closing {new Date(classroom.sunsettingAt).toLocaleDateString()}
                      </p>
                      {classroom.sunsettingMessage && (
                        <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{classroom.sunsettingMessage}</p>
                      )}
                      {classroom.successorId && (
                        <button
                          onClick={() => router.push(`/classroom/${classroom.successorId}`)}
                          className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline"
                        >
                          Join next cohort →
                        </button>
                      )}
                    </div>
                  )}

                  {/* Visibility control */}
                  {classroom.isOwner && options.length > 0 && (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-100 dark:border-gray-700/60 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 text-xs">
                      <span className="text-gray-400 dark:text-gray-500 shrink-0">Visibility</span>
                      <select
                        value={classroom.visibility}
                        onChange={e => handleVisibilityChange(classroom.id, e.target.value)}
                        disabled={updatingVisibility === classroom.id}
                        className="flex-1 bg-transparent text-xs text-gray-700 dark:text-gray-300 outline-none cursor-pointer disabled:opacity-50"
                      >
                        {options.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                      </select>
                      {updatingVisibility === classroom.id && <span className="text-gray-400 shrink-0">Saving…</span>}
                    </div>
                  )}

                  {isLocked && (
                    <p className="px-1 text-xs text-muted-foreground">Visibility managed by instructor or admin.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Past Classrooms */}
        {archivedClassrooms.length > 0 && (
          <div className="mt-10">
            <button
              onClick={() => setShowArchived(v => !v)}
              className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              <span className="text-xs">{showArchived ? '▼' : '▶'}</span>
              Past Classrooms ({archivedClassrooms.length})
            </button>
            {showArchived && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {archivedClassrooms.map(classroom => (
                  <button
                    key={classroom.id}
                    onClick={() => router.push(`/classroom/${classroom.id}`)}
                    className="group rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-left shadow-sm opacity-60 hover:opacity-90 transition-opacity"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold text-gray-700 dark:text-gray-300 leading-snug">{classroom.name}</h3>
                      <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400 shrink-0">Concluded</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{classroom.instructor}</p>
                    <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{new Date(classroom.createdAt).toLocaleDateString()}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return <AuthGuard><DashboardContent /></AuthGuard>;
}
