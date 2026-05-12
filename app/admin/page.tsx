'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Key, BarChart3, Shield, Users, Sun, Moon, Monitor } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/hooks/use-theme';
import { cn } from '@/lib/utils';

interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  institution?: string;
  createdAt?: string;
}

export default function AdminPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{ userId: string; newRole: string } | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (themeRef.current && !themeRef.current.contains(e.target as Node)) {
      setThemeOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!themeOpen) return;
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [themeOpen, handleClickOutside]);

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        if (res.status === 403) {
          router.push('/dashboard');
          return;
        }
        throw new Error('Failed to fetch users');
      }
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function updateRole(userId: string, newRole: string) {
    setUpdating(userId);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: newRole }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update role');
      }

      setUsers(prev =>
        prev.map(u => u.id === userId ? { ...u, role: newRole } : u)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setUpdating(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <p className="text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Admin Panel</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/settings')}
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
            >
              <Key className="w-3.5 h-3.5" />
              My AI Stack
            </button>
            <button
              onClick={() => router.push('/admin/usage')}
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Usage Dashboard
            </button>
            <button
              onClick={() => router.push('/admin/bulk-provision')}
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
            >
              <Users className="w-3.5 h-3.5" />
              Bulk Provision
            </button>
            <button
              onClick={() => router.push('/admin/policy')}
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
            >
              <Shield className="w-3.5 h-3.5" />
              Policy
            </button>
            <button
              onClick={() => router.push('/')}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              ← Back to App
            </button>

            {/* Theme Selector */}
            <div className="relative" ref={themeRef}>
              <button
                onClick={() => setThemeOpen(!themeOpen)}
                className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                title="Change theme"
              >
                {theme === 'light' && <Sun className="w-4 h-4" />}
                {theme === 'dark' && <Moon className="w-4 h-4" />}
                {theme === 'system' && <Monitor className="w-4 h-4" />}
              </button>
              {themeOpen && (
                <div className="absolute top-full mt-2 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-50 min-w-[140px]">
                  <button
                    onClick={() => { setTheme('light'); setThemeOpen(false); }}
                    className={cn(
                      'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                      theme === 'light' && 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                    )}
                  >
                    <Sun className="w-4 h-4" /> Light
                  </button>
                  <button
                    onClick={() => { setTheme('dark'); setThemeOpen(false); }}
                    className={cn(
                      'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                      theme === 'dark' && 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                    )}
                  >
                    <Moon className="w-4 h-4" /> Dark
                  </button>
                  <button
                    onClick={() => { setTheme('system'); setThemeOpen(false); }}
                    className={cn(
                      'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                      theme === 'system' && 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                    )}
                  >
                    <Monitor className="w-4 h-4" /> System
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-red-500">×</button>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Users ({users.length})</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Manage user roles. Admins and instructors can create classrooms and configure AI providers.
            </p>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {users.map(user => (
              <div key={user.id} className="px-6 py-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {user.name || 'Unnamed'}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{user.email}</p>
                  {user.institution && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">{user.institution}</p>
                  )}
                </div>

                <div className="ml-4 flex items-center gap-2">
                  <select
                    value={user.role}
                    onChange={e => {
                      if (e.target.value !== user.role) {
                        setPendingRoleChange({ userId: user.id, newRole: e.target.value });
                      }
                    }}
                    disabled={updating === user.id}
                    className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-200
                      focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                  >
                    <option value="admin">Admin</option>
                    <option value="instructor">Instructor</option>
                    <option value="student">Student</option>
                  </select>
                  {updating === user.id && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">Updating...</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {users.length === 0 && (
            <div className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">
              No users found.
            </div>
          )}
        </div>

        <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">Quick Reference</h2>
          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
            <div className="flex gap-3">
              <span className="font-medium w-20 text-gray-800 dark:text-gray-200">Admin</span>
              <span>Full access — manage users, configure institutional providers, all classrooms</span>
            </div>
            <div className="flex gap-3">
              <span className="font-medium w-20 text-gray-800 dark:text-gray-200">Instructor</span>
              <span>Create classrooms, bring own AI keys, enroll students, manage own content</span>
            </div>
            <div className="flex gap-3">
              <span className="font-medium w-20 text-gray-800 dark:text-gray-200">Student</span>
              <span>Attend classrooms, use institutional AI providers (no own keys by default)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Role change confirm dialog (#14) */}
      {pendingRoleChange && (() => {
        const targetUser = users.find(u => u.id === pendingRoleChange.userId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="rounded-xl border bg-white dark:bg-gray-800 dark:border-gray-700 p-6 max-w-sm w-full mx-4 shadow-xl">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Confirm role change</h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Change <strong>{targetUser?.name || targetUser?.email}</strong> from{' '}
                <strong>{targetUser?.role}</strong> to{' '}
                <strong>{pendingRoleChange.newRole}</strong>?
              </p>
              <div className="mt-5 flex gap-2 justify-end">
                <button
                  onClick={() => setPendingRoleChange(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors dark:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    updateRole(pendingRoleChange.userId, pendingRoleChange.newRole);
                    setPendingRoleChange(null);
                  }}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
