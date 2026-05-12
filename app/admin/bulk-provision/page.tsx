'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { Copy } from 'lucide-react';

interface ParsedRow {
  email: string;
  name: string;
  role: string;
  password?: string;
  errors: string[];
}

interface CreatedUser {
  email: string;
  role: string;
  tempPassword?: string;
}

interface SkippedUser {
  email: string;
  reason: string;
}

interface ErrorUser {
  email: string;
  error: string;
}

interface ProvisionResult {
  success: boolean;
  created: CreatedUser[];
  skipped: SkippedUser[];
  errors: ErrorUser[];
}

export default function BulkProvisionPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [defaultRole, setDefaultRole] = useState('student');
  const [parsedRows, setParsedRows] = useState<ParsedRow[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'true') {
      setAuthChecked(true);
      return;
    }
    authClient.getSession().then((session: any) => {
      const role = session?.data?.user?.role;
      if (!session?.data?.user || role !== 'admin') {
        router.replace('/dashboard');
        return;
      }
      setAuthChecked(true);
    });
  }, [router]);

  function parseCSV(text: string): ParsedRow[] {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const dataLines = lines[0]?.toLowerCase().startsWith('email') ? lines.slice(1) : lines;
    return dataLines.map(line => {
      const cols: string[] = [];
      let current = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuote = !inQuote;
        } else if (ch === ',' && !inQuote) {
          cols.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      cols.push(current.trim());

      const [email = '', name = '', roleRaw = '', password = ''] = cols;
      const errors: string[] = [];
      if (!email) errors.push('Missing email');
      if (!name) errors.push('Missing name');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Invalid email format');

      const role = roleRaw || defaultRole;
      const validRoles = ['admin', 'instructor', 'student', 'user'];
      if (role && !validRoles.includes(role)) errors.push(`Invalid role: ${role}`);

      return {
        email,
        name,
        role,
        password: password || undefined,
        errors,
      };
    });
  }

  function handleParse() {
    const rows = parseCSV(csvText);
    setParsedRows(rows);
    setResult(null);
    setSubmitError(null);
  }

  async function handleSubmit() {
    if (!parsedRows || parsedRows.length === 0) return;
    const validRows = parsedRows.filter(r => r.errors.length === 0);
    if (validRows.length === 0) {
      setSubmitError('No valid rows to submit.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/bulk-provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          users: validRows.map(r => ({
            email: r.email,
            name: r.name,
            role: r.role,
            ...(r.password ? { password: r.password } : {}),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || 'Request failed');
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setSubmitError(err.message || 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  function copyToClipboard(text: string, index: number) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  const validCount = parsedRows ? parsedRows.filter(r => r.errors.length === 0).length : 0;
  const errorCount = parsedRows ? parsedRows.filter(r => r.errors.length > 0).length : 0;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Bulk Provision Users</h1>
          <button
            onClick={() => router.push('/admin')}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            &larr; Back to Admin
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">CSV Input</h2>
          <p className="text-sm text-gray-500 mb-4">
            Columns: <code className="bg-gray-100 px-1 rounded">email, name, role, password</code>{' '}
            (role and password are optional). First row may be a header.
          </p>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Role (used when role column is empty)
            </label>
            <select
              value={defaultRole}
              onChange={e => setDefaultRole(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="student">Student</option>
              <option value="instructor">Instructor</option>
            </select>
          </div>

          <textarea
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            placeholder={"email,name,role,password\nalice@example.com,Alice Smith,student\nbob@example.com,Bob Jones,instructor,mypassword"}
            rows={8}
            className="w-full text-sm font-mono border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
          />

          <div className="mt-4 flex gap-3">
            <button
              onClick={handleParse}
              disabled={!csvText.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              Parse &amp; Preview
            </button>
            {parsedRows && validCount > 0 && (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Submitting...' : `Submit ${validCount} user${validCount !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>

          {submitError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {submitError}
            </div>
          )}
        </div>

        {parsedRows && parsedRows.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">
                Preview &mdash; {parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''}
                {errorCount > 0 && (
                  <span className="ml-2 text-sm text-red-600 font-normal">
                    ({errorCount} with errors)
                  </span>
                )}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Password</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {parsedRows.map((row, i) => (
                    <tr
                      key={i}
                      className={row.errors.length > 0 ? 'bg-red-50' : ''}
                    >
                      <td className="px-4 py-3 font-mono text-xs">{row.email || '\u2014'}</td>
                      <td className="px-4 py-3">{row.name || '\u2014'}</td>
                      <td className="px-4 py-3">{row.role}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {row.password ? '(provided)' : '(auto-generated)'}
                      </td>
                      <td className="px-4 py-3">
                        {row.errors.length === 0 ? (
                          <span className="text-green-600 text-xs">\u2713 Valid</span>
                        ) : (
                          <span className="text-red-600 text-xs">{row.errors.join('; ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {result.created.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-green-50">
                  <h2 className="text-lg font-semibold text-green-800">
                    Created ({result.created.length})
                  </h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {result.created.map((u, i) => (
                    <div key={i} className="px-6 py-3 flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium text-gray-900">{u.email}</span>
                        <span className="ml-2 text-xs text-gray-400">{u.role}</span>
                      </div>
                      {u.tempPassword && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">Temp password:</span>
                          <code className="font-mono text-xs bg-gray-100 px-2 py-1 rounded select-all">
                            {u.tempPassword}
                          </code>
                          <button
                            onClick={() => copyToClipboard(u.tempPassword!, i)}
                            className="p-1 rounded hover:bg-gray-100 transition-colors"
                            title="Copy password"
                          >
                            <Copy className="w-3.5 h-3.5 text-gray-400" />
                          </button>
                          {copiedIndex === i && (
                            <span className="text-xs text-green-600">Copied!</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.skipped.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-yellow-50">
                  <h2 className="text-lg font-semibold text-yellow-800">
                    Skipped ({result.skipped.length})
                  </h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {result.skipped.map((u, i) => (
                    <div key={i} className="px-6 py-3 flex items-center justify-between">
                      <span className="text-sm text-gray-900">{u.email}</span>
                      <span className="text-xs text-yellow-700">{u.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-red-50">
                  <h2 className="text-lg font-semibold text-red-800">
                    Errors ({result.errors.length})
                  </h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {result.errors.map((u, i) => (
                    <div key={i} className="px-6 py-3 flex items-center justify-between">
                      <span className="text-sm text-gray-900">{u.email}</span>
                      <span className="text-xs text-red-600">{u.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
