'use client';

import { useEffect, useState } from 'react';
import { Key, BarChart3 } from 'lucide-react';
import { useRouter } from 'next/navigation';

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
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  // Pending role change: wait for explicit confirm before writing to server (#14)
  const [pendingRoleChange, setPendingRoleChange] = useState<{ userId: string; newRole: string } | null>(null);

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
          // Non-admin authenticated user — send to dashboard, not login
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

      // Update local state
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/settings')}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Key className="w-3.5 h-3.5" />
              My AI Stack
            </button>
            <button
              onClick={() => router.push('/admin/usage')}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Usage Dashboard
            </button>
            <button
              onClick={() => router.push('/')}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back to App
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-red-500">×</button>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800">Users ({users.length})</h2>
            <p className="text-sm text-gray-500 mt-1">
              Manage user roles. Admins and instructors can create classrooms and configure AI providers.
            </p>
          </div>

          <div className="divide-y divide-gray-100">
            {users.map(user => (
              <div key={user.id} className="px-6 py-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {user.name || 'Unnamed'}
                  </p>
                  <p className="text-sm text-gray-500 truncate">{user.email}</p>
                  {user.institution && (
                    <p className="text-xs text-gray-400">{user.institution}</p>
                  )}
                </div>

                <div className="ml-4 flex items-center gap-2">
                  <select
                    value={user.role}
                    onChange={e => {
                      // Stage the change — don't write until confirmed (#14)
                      if (e.target.value !== user.role) {
                        setPendingRoleChange({ userId: user.id, newRole: e.target.value });
                      }
                    }}
                    disabled={updating === user.id}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white
                      focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                  >
                    <option value="admin">Admin</option>
                    <option value="instructor">Instructor</option>
                    <option value="student">Student</option>
                  </select>
                  {updating === user.id && (
                    <span className="text-xs text-gray-400">Updating...</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {users.length === 0 && (
            <div className="px-6 py-12 text-center text-gray-400">
              No users found.
            </div>
          )}
        </div>

        <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Quick Reference</h2>
          <div className="text-sm text-gray-600 space-y-2">
            <div className="flex gap-3">
              <span className="font-medium w-20 text-gray-800">Admin</span>
              <span>Full access — manage users, configure institutional providers, all classrooms</span>
            </div>
            <div className="flex gap-3">
              <span className="font-medium w-20 text-gray-800">Instructor</span>
              <span>Create classrooms, bring own AI keys, enroll students, manage own content</span>
            </div>
            <div className="flex gap-3">
              <span className="font-medium w-20 text-gray-800">Student</span>
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
            <div className="rounded-xl border bg-white p-6 max-w-sm w-full mx-4 shadow-xl">
              <h3 className="text-base font-semibold text-gray-900">Confirm role change</h3>
              <p className="mt-2 text-sm text-gray-600">
                Change <strong>{targetUser?.name || targetUser?.email}</strong> from{' '}
                <strong>{targetUser?.role}</strong> to{' '}
                <strong>{pendingRoleChange.newRole}</strong>?
              </p>
              <div className="mt-5 flex gap-2 justify-end">
                <button
                  onClick={() => setPendingRoleChange(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
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
